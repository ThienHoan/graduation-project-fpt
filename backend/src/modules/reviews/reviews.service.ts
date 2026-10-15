import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { ok } from '../../common/api-response';
import { moderateReviewContent, extractFitFeedback, embedFitFeedback } from './utils/content-moderator';

export type ReviewFilterOptions = {
  rating?: number;
  hasMedia?: boolean;
  fit?: string;
  page?: number;
  limit?: number;
};

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async create(customerId: string, createReviewDto: CreateReviewDto) {
    const { garmentId, rating } = createReviewDto;
    let { bookingId } = createReviewDto;

    // 1. AI Content Moderation
    const moderation = moderateReviewContent(createReviewDto.comment);
    if (moderation.shouldBlock) {
      throw new BadRequestException(
        `Bình luận vi phạm tiêu chuẩn cộng đồng: ${moderation.flaggedReason}. Vui lòng sử dụng ngôn từ phù hợp.`
      );
    }

    // Gắn tag fitFeedback nếu có vào comment
    const finalComment = embedFitFeedback(createReviewDto.comment, createReviewDto.fitFeedback);

    // If bookingId is not provided, try to find an eligible one
    if (!bookingId) {
      // Find all completed/returned bookings by this customer containing this garment
      const eligibleBookings = await this.prisma.booking.findMany({
        where: {
          customerId,
          status: { in: ['completed', 'returned'] },
          items: {
            some: { garmentId }
          }
        },
        include: { reviews: true },
        orderBy: { createdAt: 'desc' }
      });

      // Find the first booking that doesn't have a review for this garment
      const availableBooking = eligibleBookings.find(
        (b) => !b.reviews.some((r) => r.garmentId === garmentId)
      );

      if (!availableBooking) {
        throw new BadRequestException('Bạn chưa từng thuê hoặc đã đánh giá tất cả các đơn hàng cho sản phẩm này');
      }

      bookingId = availableBooking.id;
    }

    // Check if the booking exists and belongs to the customer
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.customerId !== customerId) {
      throw new ForbiddenException('You can only review your own bookings');
    }

    // Check if the booking contains the garment
    const hasGarment = booking.items.some((item) => item.garmentId === garmentId);
    if (!hasGarment) {
      throw new BadRequestException('This garment is not part of the specified booking');
    }
    
    // Check if booking is completed/returned
    if (booking.status !== 'completed' && booking.status !== 'returned') {
      throw new BadRequestException('You can only review a garment after the booking is returned or completed');
    }

    // Check if review already exists for this booking/garment combo
    const existingReview = await this.prisma.review.findUnique({
      where: {
        customerId_garmentId_bookingId: {
          customerId,
          garmentId,
          bookingId,
        },
      },
    });

    if (existingReview) {
      throw new BadRequestException('You have already reviewed this garment for this booking');
    }

    // Create review
    const review = await this.prisma.review.create({
      data: {
        customerId,
        garmentId,
        bookingId,
        rating,
        comment: finalComment,
        images: createReviewDto.images || [],
        video: createReviewDto.video || null,
        isReported: !moderation.isClean,
        reportedReason: moderation.flaggedReason ?? null,
      },
    });

    const parsed = extractFitFeedback(review.comment);
    return ok({
      ...review,
      comment: parsed.cleanComment,
      fitFeedback: parsed.fitFeedback,
    });
  }

  async findAllByGarment(garmentId: string, filterOptions?: ReviewFilterOptions) {
    const rawReviews = await this.prisma.review.findMany({
      where: { garmentId, status: 'public' },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              }
            }
          },
        },
        repliedByUser: {
          select: {
            id: true,
            profile: {
              select: {
                fullName: true,
              }
            }
          }
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Tính toán thống kê toàn bộ (Rating breakdown & Fit counts)
    const ratingCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const fitCounts: Record<string, number> = { tight: 0, true_to_size: 0, loose: 0 };
    let mediaCount = 0;

    const parsedReviews = rawReviews.map((r) => {
      ratingCounts[r.rating] = (ratingCounts[r.rating] || 0) + 1;
      const hasMedia = (r.images && r.images.length > 0) || Boolean(r.video);
      if (hasMedia) mediaCount++;

      const { cleanComment, fitFeedback } = extractFitFeedback(r.comment);
      if (fitFeedback) {
        fitCounts[fitFeedback] = (fitCounts[fitFeedback] || 0) + 1;
      }

      return {
        ...r,
        comment: cleanComment,
        fitFeedback,
        hasMedia,
      };
    });

    const averageRating = parsedReviews.length > 0 
      ? parsedReviews.reduce((sum: number, review) => sum + review.rating, 0) / parsedReviews.length 
      : 0;

    // Áp dụng bộ lọc
    let filtered = parsedReviews;
    if (filterOptions?.rating) {
      filtered = filtered.filter((r) => r.rating === filterOptions.rating);
    }
    if (filterOptions?.hasMedia !== undefined) {
      filtered = filtered.filter((r) => r.hasMedia === filterOptions.hasMedia);
    }
    if (filterOptions?.fit) {
      filtered = filtered.filter((r) => r.fitFeedback === filterOptions.fit);
    }

    // Phân trang
    const page = filterOptions?.page || 1;
    const limit = filterOptions?.limit || 10;
    const totalPages = Math.ceil(filtered.length / limit) || 1;
    const paginatedReviews = filtered.slice((page - 1) * limit, page * limit);

    return ok({
      reviews: paginatedReviews,
      total: parsedReviews.length,
      filteredTotal: filtered.length,
      averageRating: Number(averageRating.toFixed(1)),
      ratingCounts,
      mediaCount,
      fitCounts,
      page,
      totalPages,
      limit,
    });
  }

  async findAllByCustomer(customerId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { customerId },
      include: {
        garment: {
          select: {
            id: true,
            name: true,
            images: {
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const parsed = reviews.map((r) => {
      const { cleanComment, fitFeedback } = extractFitFeedback(r.comment);
      return {
        ...r,
        comment: cleanComment,
        fitFeedback,
      };
    });

    return ok(parsed);
  }

  async update(id: string, customerId: string, updateReviewDto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.customerId !== customerId) {
      throw new ForbiddenException('You can only update your own reviews');
    }

    if (review.isLocked) {
      throw new ForbiddenException('Đánh giá này đã bị khóa vĩnh viễn và không thể chỉnh sửa');
    }

    // AI Content Moderation khi sửa
    let moderationFlagged = false;
    let moderationReason: string | null = null;
    if (updateReviewDto.comment !== undefined) {
      const moderation = moderateReviewContent(updateReviewDto.comment);
      if (moderation.shouldBlock) {
        throw new BadRequestException(
          `Bình luận vi phạm tiêu chuẩn cộng đồng: ${moderation.flaggedReason}. Vui lòng sử dụng ngôn từ phù hợp.`
        );
      }
      moderationFlagged = !moderation.isClean;
      moderationReason = moderation.flaggedReason ?? null;
    }

    const { fitFeedback, ...restDto } = updateReviewDto;
    let finalComment = restDto.comment;
    if (finalComment !== undefined || fitFeedback !== undefined) {
      const existing = extractFitFeedback(review.comment);
      const chosenFit = fitFeedback !== undefined ? fitFeedback : existing.fitFeedback;
      const chosenComment = finalComment !== undefined ? finalComment : existing.cleanComment;
      finalComment = embedFitFeedback(chosenComment, chosenFit) ?? undefined;
    }

    const isCurrentlyHidden = review.status === 'hidden';
    const newEditCount = isCurrentlyHidden ? review.editCount + 1 : review.editCount;

    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        ...restDto,
        comment: finalComment,
        editCount: newEditCount,
        status: isCurrentlyHidden ? 'public' : review.status,
        isReported: moderationFlagged ? true : (isCurrentlyHidden ? false : review.isReported),
        reportedReason: moderationReason ?? review.reportedReason,
      },
    });

    const parsed = extractFitFeedback(updated.comment);
    return ok({
      ...updated,
      comment: parsed.cleanComment,
      fitFeedback: parsed.fitFeedback,
    });
  }

  async remove(id: string, customerId: string, isAdmin = false) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.customerId !== customerId && !isAdmin) {
      throw new ForbiddenException('You do not have permission to delete this review');
    }

    const deleted = await this.prisma.review.delete({
      where: { id },
    });
    return ok(deleted);
  }

  // --- Staff & Manager Methods ---

  async findAllStaff() {
    const reviews = await this.prisma.review.findMany({
      include: {
        customer: { select: { id: true, profile: { select: { fullName: true } } } },
        garment: { select: { id: true, name: true } },
        repliedByUser: { select: { id: true, profile: { select: { fullName: true } } } },
        reportedByUser: { select: { id: true, profile: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return ok(reviews);
  }

  async replyToReview(id: string, staffId: string, replyReviewDto: ReplyReviewDto) {
    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        staffReply: replyReviewDto.reply,
        staffReplyAt: new Date(),
        staffRepliedBy: staffId,
      },
      include: { garment: { select: { name: true } } },
    });

    await this.notificationsService.notifyUser({
      userId: updated.customerId,
      templateKey: 'notification.test',
      channels: ['inApp'],
      data: {
        message: `Quản trị viên đã phản hồi đánh giá của bạn cho sản phẩm "${updated.garment.name}".`,
      },
    });

    return ok(updated);
  }

  async reportReview(id: string, staffId: string, reportReviewDto: ReportReviewDto) {
    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        isReported: true,
        reportedReason: reportReviewDto.reason,
        reportedAt: new Date(),
        reportedBy: staffId,
      },
    });
    return ok(updated);
  }

  async hideReview(id: string, reason?: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: { garment: { select: { name: true } } },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    const hideReason = reason || 'Vi phạm tiêu chuẩn cộng đồng';
    const willLock = review.editCount >= 3;

    const updated = await this.prisma.review.update({
      where: { id },
      data: { 
        status: 'hidden',
        isLocked: willLock,
      },
    });

    // Notify customer
    const message = willLock 
      ? `Đánh giá của bạn cho sản phẩm "${review.garment.name}" đã bị KHÓA vĩnh viễn.\nLý do: ${hideReason}`
      : `Đánh giá của bạn cho sản phẩm "${review.garment.name}" đã bị ẩn.\nLý do: ${hideReason}\nBạn có thể chỉnh sửa và gửi lại (còn ${3 - review.editCount} lần thử).`;

    await this.notificationsService.notifyUser({
      userId: review.customerId,
      templateKey: 'notification.test',
      channels: ['inApp'],
      data: { message },
    });

    return ok(updated);
  }
}
