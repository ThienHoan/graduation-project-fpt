import { describe, expect, it, vi } from 'vitest';
import { ReviewStatisticsService } from './review-statistics.service';

describe('ReviewStatisticsService', () => {
  const createMockPrisma = () => ({
    review: {
      findMany: vi.fn(),
    },
  });

  it('calculates default statistics when reviews list is empty', () => {
    const prisma = createMockPrisma();
    const service = new ReviewStatisticsService(prisma as never);

    const stats = service.calculateStatistics([]);

    expect(stats.total).toBe(0);
    expect(stats.averageRating).toBe(0);
    expect(stats.recommendPercentage).toBe(0);
    expect(stats.ratingCounts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(stats.ratingPercentages).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(stats.fitCounts).toEqual({ tight: 0, true_to_size: 0, loose: 0 });
    expect(stats.fitPercentages).toEqual({ tight: 0, true_to_size: 0, loose: 0 });
    expect(stats.mediaCount).toBe(0);
    expect(stats.mediaPercentage).toBe(0);
  });

  it('accurately computes averages, percentages, and breakdowns', () => {
    const prisma = createMockPrisma();
    const service = new ReviewStatisticsService(prisma as never);

    const sampleReviews = [
      {
        rating: 5,
        comment: '[FIT:true_to_size] Rất đẹp và vừa vặn',
        images: ['https://cdn.example.com/photo1.jpg'],
      },
      {
        rating: 5,
        comment: '[FIT:true_to_size] Tuyệt vời',
        images: [],
      },
      {
        rating: 4,
        comment: '[FIT:tight] Hơi ôm eo chút nhưng chất vải mịn',
        video: 'https://cdn.example.com/video1.mp4',
      },
      {
        rating: 2,
        comment: '[FIT:loose] Quá rộng so với bảng size',
        images: ['https://cdn.example.com/photo2.jpg'],
      },
    ];

    const stats = service.calculateStatistics(sampleReviews);

    // Total = 4
    expect(stats.total).toBe(4);
    // Average = (5 + 5 + 4 + 2) / 4 = 16 / 4 = 4.0
    expect(stats.averageRating).toBe(4);
    // Positive ratings: 3 out of 4 (5, 5, 4) => 75%
    expect(stats.recommendPercentage).toBe(75);
    // Rating counts
    expect(stats.ratingCounts[5]).toBe(2);
    expect(stats.ratingCounts[4]).toBe(1);
    expect(stats.ratingCounts[2]).toBe(1);
    expect(stats.ratingCounts[1]).toBe(0);
    // Rating percentages
    expect(stats.ratingPercentages[5]).toBe(50);
    expect(stats.ratingPercentages[4]).toBe(25);
    expect(stats.ratingPercentages[2]).toBe(25);
    // Media counts: 3 items have media (photo1, video1, photo2) => 75%
    expect(stats.mediaCount).toBe(3);
    expect(stats.mediaPercentage).toBe(75);
    // Fit counts: 2 true_to_size, 1 tight, 1 loose
    expect(stats.fitCounts.true_to_size).toBe(2);
    expect(stats.fitCounts.tight).toBe(1);
    expect(stats.fitCounts.loose).toBe(1);
    // Fit percentages: 2/4 = 50%, 1/4 = 25%, 1/4 = 25%
    expect(stats.fitPercentages.true_to_size).toBe(50);
    expect(stats.fitPercentages.tight).toBe(25);
    expect(stats.fitPercentages.loose).toBe(25);
  });

  it('queries database via getGarmentStatistics', async () => {
    const prisma = createMockPrisma();
    prisma.review.findMany.mockResolvedValue([
      { rating: 5, comment: 'Đồ đẹp', images: [], video: null },
      { rating: 5, comment: 'Chuẩn', images: ['img.png'], video: null },
    ]);

    const service = new ReviewStatisticsService(prisma as never);
    const stats = await service.getGarmentStatistics('garment-100');

    expect(prisma.review.findMany).toHaveBeenCalledWith({
      where: { garmentId: 'garment-100', status: 'public' },
      select: { rating: true, comment: true, images: true, video: true },
    });
    expect(stats.total).toBe(2);
    expect(stats.averageRating).toBe(5);
    expect(stats.recommendPercentage).toBe(100);
  });
});

