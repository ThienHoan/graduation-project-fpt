import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { extractFitFeedback } from '../utils/content-moderator';

export type RatingCounts = Record<1 | 2 | 3 | 4 | 5, number>;
export type RatingPercentages = Record<1 | 2 | 3 | 4 | 5, number>;

export type FitCounts = {
  tight: number;
  true_to_size: number;
  loose: number;
};

export type FitPercentages = {
  tight: number;
  true_to_size: number;
  loose: number;
};

export type ReviewStatistics = {
  total: number;
  averageRating: number;
  recommendPercentage: number;
  ratingCounts: RatingCounts;
  ratingPercentages: RatingPercentages;
  fitCounts: FitCounts;
  fitPercentages: FitPercentages;
  mediaCount: number;
  mediaPercentage: number;
};

export type ReviewWithCommentAndMedia = {
  rating: number;
  comment?: string | null;
  fitFeedback?: 'tight' | 'true_to_size' | 'loose' | null;
  images?: string[];
  video?: string | null;
};

@Injectable()
export class ReviewStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tính toán bộ thống kê hoàn chỉnh từ danh sách các review đã có
   */
  calculateStatistics(reviews: ReviewWithCommentAndMedia[]): ReviewStatistics {
    const total = reviews.length;
    const ratingCounts: RatingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const fitCounts: FitCounts = { tight: 0, true_to_size: 0, loose: 0 };
    let mediaCount = 0;
    let ratingSum = 0;
    let positiveRatingCount = 0; // 4 hoặc 5 sao

    for (const r of reviews) {
      const rating = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
      ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
      ratingSum += rating;

      if (rating >= 4) {
        positiveRatingCount++;
      }

      const hasMedia = (Array.isArray(r.images) && r.images.length > 0) || Boolean(r.video);
      if (hasMedia) {
        mediaCount++;
      }

      const fitFeedback = r.fitFeedback || extractFitFeedback(r.comment).fitFeedback;
      if (fitFeedback && fitFeedback in fitCounts) {
        fitCounts[fitFeedback as keyof FitCounts]++;
      }
    }

    const averageRating = total > 0 ? Number((ratingSum / total).toFixed(1)) : 0;
    const recommendPercentage = total > 0 ? Number(((positiveRatingCount / total) * 100).toFixed(1)) : 0;
    const mediaPercentage = total > 0 ? Number(((mediaCount / total) * 100).toFixed(1)) : 0;

    const ratingPercentages: RatingPercentages = {
      1: total > 0 ? Number(((ratingCounts[1] / total) * 100).toFixed(1)) : 0,
      2: total > 0 ? Number(((ratingCounts[2] / total) * 100).toFixed(1)) : 0,
      3: total > 0 ? Number(((ratingCounts[3] / total) * 100).toFixed(1)) : 0,
      4: total > 0 ? Number(((ratingCounts[4] / total) * 100).toFixed(1)) : 0,
      5: total > 0 ? Number(((ratingCounts[5] / total) * 100).toFixed(1)) : 0,
    };

    const totalFit = fitCounts.tight + fitCounts.true_to_size + fitCounts.loose;
    const fitPercentages: FitPercentages = {
      tight: totalFit > 0 ? Number(((fitCounts.tight / totalFit) * 100).toFixed(1)) : 0,
      true_to_size: totalFit > 0 ? Number(((fitCounts.true_to_size / totalFit) * 100).toFixed(1)) : 0,
      loose: totalFit > 0 ? Number(((fitCounts.loose / totalFit) * 100).toFixed(1)) : 0,
    };

    return {
      total,
      averageRating,
      recommendPercentage,
      ratingCounts,
      ratingPercentages,
      fitCounts,
      fitPercentages,
      mediaCount,
      mediaPercentage,
    };
  }

  /**
   * Truy vấn DB và trả về thống kê đánh giá trực tiếp cho một trang phục
   */
  async getGarmentStatistics(garmentId: string): Promise<ReviewStatistics> {
    const reviews = await this.prisma.review.findMany({
      where: {
        garmentId,
        status: 'public',
      },
      select: {
        rating: true,
        comment: true,
        images: true,
        video: true,
      },
    });

    return this.calculateStatistics(reviews);
  }
}
