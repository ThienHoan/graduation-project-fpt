import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { REVIEW_ERROR_MESSAGES, REVIEW_LIMITS } from '../utils/review-constants';

export type ReviewEntityLike = {
  id: string;
  customerId: string;
  garmentId?: string;
  bookingId?: string;
  isLocked?: boolean;
  editCount?: number;
  status?: string | null;
};

@Injectable()
export class ReviewPermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kiểm tra điều kiện được phép tạo đánh giá cho một trang phục
   * Trả về bookingId hợp lệ được xác thực
   */
  async validateCanCreateReview(
    customerId: string,
    garmentId: string,
    bookingId?: string,
  ): Promise<string> {
    let resolvedBookingId = bookingId;

    if (!resolvedBookingId) {
      // Tìm các đơn đặt đồ đã hoàn thành/đã trả của khách hàng có chứa trang phục này
      const eligibleBookings = await this.prisma.booking.findMany({
        where: {
          customerId,
          status: { in: ['completed', 'returned'] },
          items: {
            some: { garmentId },
          },
        },
        include: { reviews: true },
        orderBy: { createdAt: 'desc' },
      });

      // Lấy đơn hàng đầu tiên chưa có review cho trang phục này
      const availableBooking = eligibleBookings.find(
        (b) => !b.reviews.some((r) => r.garmentId === garmentId),
      );

      if (!availableBooking) {
        throw new BadRequestException(REVIEW_ERROR_MESSAGES.NO_ELIGIBLE_BOOKING);
      }

      resolvedBookingId = availableBooking.id;
    }

    // Kiểm tra thông tin đơn hàng được chỉ định
    const booking = await this.prisma.booking.findUnique({
      where: { id: resolvedBookingId },
      include: { items: true },
    });

    if (!booking) {
      throw new NotFoundException(REVIEW_ERROR_MESSAGES.BOOKING_NOT_FOUND);
    }

    if (booking.customerId !== customerId) {
      throw new ForbiddenException(REVIEW_ERROR_MESSAGES.BOOKING_NOT_OWNED);
    }

    const hasGarment = booking.items.some((item) => item.garmentId === garmentId);
    if (!hasGarment) {
      throw new BadRequestException(REVIEW_ERROR_MESSAGES.GARMENT_NOT_IN_BOOKING);
    }

    if (booking.status !== 'completed' && booking.status !== 'returned') {
      throw new BadRequestException(REVIEW_ERROR_MESSAGES.BOOKING_NOT_COMPLETED);
    }

    // Kiểm tra xem đã có review nào cho tổ hợp này chưa
    const existingReview = await this.prisma.review.findUnique({
      where: {
        customerId_garmentId_bookingId: {
          customerId,
          garmentId,
          bookingId: resolvedBookingId,
        },
      },
    });

    if (existingReview) {
      throw new BadRequestException(REVIEW_ERROR_MESSAGES.DUPLICATE_REVIEW);
    }

    return resolvedBookingId;
  }

  /**
   * Kiểm tra quyền chỉnh sửa đánh giá
   */
  validateCanUpdateReview(review: ReviewEntityLike, customerId: string): void {
    if (review.customerId !== customerId) {
      throw new ForbiddenException(REVIEW_ERROR_MESSAGES.FORBIDDEN_UPDATE);
    }

    if (review.isLocked) {
      throw new ForbiddenException(REVIEW_ERROR_MESSAGES.LOCKED);
    }

    if (
      typeof review.editCount === 'number' &&
      review.editCount >= REVIEW_LIMITS.MAX_EDIT_COUNT
    ) {
      throw new ForbiddenException(REVIEW_ERROR_MESSAGES.MAX_EDITS_EXCEEDED);
    }
  }

  /**
   * Kiểm tra quyền xóa đánh giá
   */
  validateCanDeleteReview(
    review: ReviewEntityLike,
    customerId: string,
    isAdmin = false,
  ): void {
    if (review.customerId !== customerId && !isAdmin) {
      throw new ForbiddenException(REVIEW_ERROR_MESSAGES.FORBIDDEN_DELETE);
    }
  }

  /**
   * Kiểm tra quyền phản hồi đánh giá
   */
  validateCanReply(role: string): void {
    const allowedRoles = ['staff', 'manager_owner', 'admin'];
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('Bạn không có quyền phản hồi đánh giá này');
    }
  }

  /**
   * Kiểm tra quyền báo cáo đánh giá
   */
  validateCanReport(role: string): void {
    const allowedRoles = ['staff', 'manager_owner', 'admin'];
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('Bạn không có quyền báo cáo đánh giá này');
    }
  }

  /**
   * Kiểm tra quyền ẩn đánh giá
   */
  validateCanHide(role: string): void {
    const allowedRoles = ['manager_owner', 'admin'];
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('Chỉ cấp quản trị viên mới có quyền ẩn đánh giá');
    }
  }
}
