import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { ok } from '../../common/api-response';
import { ReviewPermissionService } from './services/review-permission.service';
import { ReviewStatisticsService } from './services/review-statistics.service';
import { ReviewModerationService } from './services/review-moderation.service';
import { ReviewQueryService } from './services/review-query.service';
import { REVIEW_ERROR_MESSAGES } from './utils/review-constants';

export type ReviewFilterOptions = ReviewQueryDto;

@Injectable()
export class ReviewsService {
  private readonly permissionService: ReviewPermissionService;
  private readonly statisticsService: ReviewStatisticsService;
  private readonly moderationService: ReviewModerationService;
  private readonly queryService: ReviewQueryService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    permissionService?: ReviewPermissionService,
    statisticsService?: ReviewStatisticsService,
    moderationService?: ReviewModerationService,
    queryService?: ReviewQueryService,
  ) {
    this.statisticsService = statisticsService || new ReviewStatisticsService(prisma);
    this.permissionService = permissionService || new ReviewPermissionService(prisma);
    this.moderationService = moderationService || new ReviewModerationService();
    this.queryService = queryService || new ReviewQueryService(prisma, this.statisticsService);
  }

  /**
   * Tạo mới một đánh giá trang phục từ khách hàng
   */
  async create(customerId: string, createReviewDto: CreateReviewDto) {
    const { garmentId, rating, images, video } = createReviewDto;

    // 1. Kiểm duyệt nội dung bằng AI Content Moderation
    const moderation = this.moderationService.assertContentAllowed(createReviewDto.comment);

    // 2. Kiểm tra quyền và tính hợp lệ của đơn đặt đồ
    const bookingId = await this.permissionService.validateCanCreateReview(
      customerId,
      garmentId,
      createReviewDto.bookingId,
    );

    // 3. Gắn tag fitFeedback nếu có vào nội dung lưu trữ
    const finalComment = this.moderationService.embedFitFeedback(
      createReviewDto.comment,
      createReviewDto.fitFeedback,
    );

    // 4. Lưu đánh giá vào Database
    const review = await this.prisma.review.create({
      data: {
        customerId,
        garmentId,
        bookingId,
        rating,
        comment: finalComment,
        images: images || [],
        video: video || null,
        isReported: !moderation.isClean,
        reportedReason: moderation.flaggedReason ?? null,
      },
    });

    const parsed = this.moderationService.extractFitFeedback(review.comment);
    return ok({
      ...review,
      comment: parsed.cleanComment,
      fitFeedback: parsed.fitFeedback,
    });
  }

  /**
   * Truy vấn danh sách đánh giá của trang phục (kèm thống kê, lọc, sắp xếp, phân trang)
   */
  async findAllByGarment(garmentId: string, filterOptions?: ReviewQueryDto) {
    const result = await this.queryService.findGarmentReviews(garmentId, filterOptions);
    return ok(result);
  }

  /**
   * Lấy riêng dữ liệu thống kê đánh giá của trang phục
   */
  async getGarmentStatistics(garmentId: string) {
    const stats = await this.statisticsService.getGarmentStatistics(garmentId);
    return ok(stats);
  }

  /**
   * Lấy danh sách đánh giá do chính khách hàng đã tạo
   */
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
      const { cleanComment, fitFeedback } = this.moderationService.extractFitFeedback(r.comment);
      return {
        ...r,
        comment: cleanComment,
        fitFeedback,
      };
    });

    return ok(parsed);
  }

  /**
   * Cập nhật đánh giá của khách hàng
   */
  async update(id: string, customerId: string, updateReviewDto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(REVIEW_ERROR_MESSAGES.NOT_FOUND);
    }

    // Kiểm tra quyền chỉnh sửa và trạng thái khóa
    this.permissionService.validateCanUpdateReview(review, customerId);

    // AI Content Moderation khi chỉnh sửa comment
    let moderationFlagged = false;
    let moderationReason: string | null = null;
    if (updateReviewDto.comment !== undefined) {
      const moderation = this.moderationService.assertContentAllowed(updateReviewDto.comment);
      moderationFlagged = !moderation.isClean;
      moderationReason = moderation.flaggedReason ?? null;
    }

    const { fitFeedback, ...restDto } = updateReviewDto;
    let finalComment = restDto.comment;
    if (finalComment !== undefined || fitFeedback !== undefined) {
      const existing = this.moderationService.extractFitFeedback(review.comment);
      const chosenFit = fitFeedback !== undefined ? fitFeedback : existing.fitFeedback;
      const chosenComment = finalComment !== undefined ? finalComment : existing.cleanComment;
      finalComment = this.moderationService.embedFitFeedback(chosenComment, chosenFit) ?? undefined;
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

    const parsed = this.moderationService.extractFitFeedback(updated.comment);
    return ok({
      ...updated,
      comment: parsed.cleanComment,
      fitFeedback: parsed.fitFeedback,
    });
  }

  /**
   * Xóa đánh giá (khách hàng xóa đánh giá của mình hoặc Admin xóa)
   */
  async remove(id: string, customerId: string, isAdmin = false) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(REVIEW_ERROR_MESSAGES.NOT_FOUND);
    }

    this.permissionService.validateCanDeleteReview(review, customerId, isAdmin);

    const deleted = await this.prisma.review.delete({
      where: { id },
    });
    return ok(deleted);
  }

  // --- Staff & Manager Methods ---

  /**
   * Lấy toàn bộ danh sách đánh giá cho màn hình quản trị Staff/Manager
   */
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

  /**
   * Staff phản hồi đánh giá của khách hàng
   */
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

  /**
   * Staff báo cáo đánh giá có nghi vấn vi phạm
   */
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

  /**
   * Manager / Admin ẩn đánh giá và khóa vĩnh viễn nếu vi phạm quá số lần quy định
   */
  async hideReview(id: string, reason?: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: { garment: { select: { name: true } } },
    });

    if (!review) {
      throw new NotFoundException(REVIEW_ERROR_MESSAGES.NOT_FOUND);
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
