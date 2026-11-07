import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReviewQueryDto } from '../dto/review-query.dto';
import { ReviewSortBy } from '../utils/review-constants';
import { extractFitFeedback } from '../utils/content-moderator';
import { ReviewStatisticsService } from './review-statistics.service';

export type ParsedReviewItem = {
  id: string;
  customerId: string;
  garmentId: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  fitFeedback: 'tight' | 'true_to_size' | 'loose' | null;
  hasMedia: boolean;
  status: string | null;
  staffReply: string | null;
  staffReplyAt: Date | null;
  staffRepliedBy: string | null;
  isReported: boolean | null;
  reportedReason: string | null;
  reportedAt: Date | null;
  reportedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  images: string[];
  video: string | null;
  editCount: number | null;
  isLocked: boolean | null;
  customer?: {
    id: string;
    email: string;
    profile?: {
      fullName: string | null;
    } | null;
  };
  repliedByUser?: {
    id: string;
    profile?: {
      fullName: string | null;
    } | null;
  } | null;
};

export type PaginatedGarmentReviewsResult = {
  reviews: ParsedReviewItem[];
  total: number;
  filteredTotal: number;
  averageRating: number;
  recommendPercentage: number;
  ratingCounts: Record<number, number>;
  ratingPercentages: Record<number, number>;
  fitCounts: Record<string, number>;
  fitPercentages: Record<string, number>;
  mediaCount: number;
  mediaPercentage: number;
  page: number;
  totalPages: number;
  limit: number;
};

@Injectable()
export class ReviewQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statisticsService: ReviewStatisticsService,
  ) {}

  /**
   * Truy vấn, lọc, sắp xếp và phân trang danh sách đánh giá của trang phục
   */
  async findGarmentReviews(
    garmentId: string,
    query: ReviewQueryDto = {},
  ): Promise<PaginatedGarmentReviewsResult> {
    const rawReviews = await this.prisma.review.findMany({
      where: {
        garmentId,
        status: 'public',
      },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              },
            },
          },
        },
        repliedByUser: {
          select: {
            id: true,
            profile: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 1. Phân tích nội dung và trích xuất thông tin
    const parsedReviews: ParsedReviewItem[] = rawReviews.map((r) => {
      const { cleanComment, fitFeedback } = extractFitFeedback(r.comment);
      const hasMedia = (Array.isArray(r.images) && r.images.length > 0) || Boolean(r.video);

      return {
        ...r,
        comment: cleanComment,
        fitFeedback,
        hasMedia,
      };
    });

    // 2. Tính toán thống kê toàn bộ trên tập dữ liệu tổng
    const statistics = this.statisticsService.calculateStatistics(parsedReviews);

    // 3. Áp dụng bộ lọc (Filter)
    let filtered = parsedReviews;

    if (query.rating !== undefined) {
      filtered = filtered.filter((r) => r.rating === query.rating);
    }

    if (query.hasMedia !== undefined) {
      filtered = filtered.filter((r) => r.hasMedia === query.hasMedia);
    }

    if (query.fit) {
      filtered = filtered.filter((r) => r.fitFeedback === query.fit);
    }

    if (query.search && query.search.trim().length > 0) {
      const searchNormalized = query.search.trim().toLowerCase();
      filtered = filtered.filter((r) => {
        const commentMatch = r.comment ? r.comment.toLowerCase().includes(searchNormalized) : false;
        const customerMatch = r.customer?.profile?.fullName
          ? r.customer.profile.fullName.toLowerCase().includes(searchNormalized)
          : false;
        return commentMatch || customerMatch;
      });
    }

    // 4. Áp dụng sắp xếp (Sort)
    const sortBy = query.sortBy || ReviewSortBy.NEWEST;
    filtered.sort((a, b) => {
      switch (sortBy) {
        case ReviewSortBy.OLDEST:
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

        case ReviewSortBy.HIGHEST_RATING:
          if (b.rating !== a.rating) return b.rating - a.rating;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

        case ReviewSortBy.LOWEST_RATING:
          if (a.rating !== b.rating) return a.rating - b.rating;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

        case ReviewSortBy.MEDIA_FIRST:
          if (a.hasMedia !== b.hasMedia) return a.hasMedia ? -1 : 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

        case ReviewSortBy.NEWEST:
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    // 5. Áp dụng phân trang (Pagination)
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const totalPages = Math.ceil(filtered.length / limit) || 1;
    const paginatedReviews = filtered.slice((page - 1) * limit, page * limit);

    return {
      reviews: paginatedReviews,
      total: parsedReviews.length,
      filteredTotal: filtered.length,
      averageRating: statistics.averageRating,
      recommendPercentage: statistics.recommendPercentage,
      ratingCounts: statistics.ratingCounts,
      ratingPercentages: statistics.ratingPercentages,
      fitCounts: statistics.fitCounts,
      fitPercentages: statistics.fitPercentages,
      mediaCount: statistics.mediaCount,
      mediaPercentage: statistics.mediaPercentage,
      page,
      totalPages,
      limit,
    };
  }
}
