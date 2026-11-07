import { describe, expect, it, vi } from 'vitest';
import { ReviewQueryService } from './review-query.service';
import { ReviewStatisticsService } from './review-statistics.service';
import { ReviewSortBy } from '../utils/review-constants';

describe('ReviewQueryService', () => {
  const mockReviews = [
    {
      id: 'r1',
      customerId: 'c1',
      garmentId: 'g1',
      bookingId: 'b1',
      rating: 5,
      comment: '[FIT:true_to_size] Áo dài truyền thống gấm thêu hoa sen cực đẹp',
      images: ['https://cdn.example.com/img1.jpg'],
      video: null,
      status: 'public',
      createdAt: new Date('2026-03-01T10:00:00Z'),
      customer: { id: 'c1', email: 'lan@test.com', profile: { fullName: 'Nguyễn Thị Lan' } },
    },
    {
      id: 'r2',
      customerId: 'c2',
      garmentId: 'g1',
      bookingId: 'b2',
      rating: 3,
      comment: '[FIT:tight] Áo hơi chật phần eo',
      images: [],
      video: null,
      status: 'public',
      createdAt: new Date('2026-03-02T10:00:00Z'),
      customer: { id: 'c2', email: 'mai@test.com', profile: { fullName: 'Trần Thị Mai' } },
    },
    {
      id: 'r3',
      customerId: 'c3',
      garmentId: 'g1',
      bookingId: 'b3',
      rating: 4,
      comment: '[FIT:true_to_size] Chất lượng tốt, dịch vụ chu đáo',
      images: ['https://cdn.example.com/img2.jpg'],
      video: 'https://cdn.example.com/vid1.mp4',
      status: 'public',
      createdAt: new Date('2026-03-03T10:00:00Z'),
      customer: { id: 'c3', email: 'hoa@test.com', profile: { fullName: 'Lê Hoa' } },
    },
    {
      id: 'r4',
      customerId: 'c4',
      garmentId: 'g1',
      bookingId: 'b4',
      rating: 1,
      comment: '[FIT:loose] Rộng quá không mặc được',
      images: [],
      video: null,
      status: 'public',
      createdAt: new Date('2026-03-04T10:00:00Z'),
      customer: { id: 'c4', email: 'cuc@test.com', profile: { fullName: 'Phạm Cúc' } },
    },
  ];

  const createMockPrisma = () => ({
    review: {
      findMany: vi.fn().mockResolvedValue(mockReviews),
    },
  });

  it('retrieves and parses reviews with complete statistics summary', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    const result = await service.findGarmentReviews('g1');

    expect(result.total).toBe(4);
    expect(result.filteredTotal).toBe(4);
    // Average: (5 + 3 + 4 + 1) / 4 = 3.3
    expect(result.averageRating).toBe(3.3);
    expect(result.mediaCount).toBe(2);
    expect(result.fitCounts.true_to_size).toBe(2);
    expect(result.fitCounts.tight).toBe(1);
    expect(result.fitCounts.loose).toBe(1);
  });

  it('filters by rating correctly', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    const result = await service.findGarmentReviews('g1', { rating: 5 });

    expect(result.filteredTotal).toBe(1);
    expect(result.reviews[0].id).toBe('r1');
    expect(result.total).toBe(4); // Total unfiltered remains 4
  });

  it('filters by hasMedia flag', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    const result = await service.findGarmentReviews('g1', { hasMedia: true });

    expect(result.filteredTotal).toBe(2);
    expect(result.reviews.every((r) => r.hasMedia)).toBe(true);
  });

  it('filters by fit feedback tag', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    const result = await service.findGarmentReviews('g1', { fit: 'tight' });

    expect(result.filteredTotal).toBe(1);
    expect(result.reviews[0].id).toBe('r2');
  });

  it('searches by keyword in comment or author name', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    // Search text in comment
    const commentSearchResult = await service.findGarmentReviews('g1', { search: 'hoa sen' });
    expect(commentSearchResult.filteredTotal).toBe(1);
    expect(commentSearchResult.reviews[0].id).toBe('r1');

    // Search author name
    const authorSearchResult = await service.findGarmentReviews('g1', { search: 'Lê Hoa' });
    expect(authorSearchResult.filteredTotal).toBe(1);
    expect(authorSearchResult.reviews[0].id).toBe('r3');
  });

  it('sorts correctly: HIGHEST_RATING, LOWEST_RATING, OLDEST, MEDIA_FIRST', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    // Highest rating first
    const highest = await service.findGarmentReviews('g1', { sortBy: ReviewSortBy.HIGHEST_RATING });
    expect(highest.reviews[0].rating).toBe(5);
    expect(highest.reviews[highest.reviews.length - 1].rating).toBe(1);

    // Lowest rating first
    const lowest = await service.findGarmentReviews('g1', { sortBy: ReviewSortBy.LOWEST_RATING });
    expect(lowest.reviews[0].rating).toBe(1);

    // Oldest first
    const oldest = await service.findGarmentReviews('g1', { sortBy: ReviewSortBy.OLDEST });
    expect(oldest.reviews[0].id).toBe('r1'); // 2026-03-01

    // Media first
    const mediaFirst = await service.findGarmentReviews('g1', { sortBy: ReviewSortBy.MEDIA_FIRST });
    expect(mediaFirst.reviews[0].hasMedia).toBe(true);
    expect(mediaFirst.reviews[1].hasMedia).toBe(true);
  });

  it('paginates accurately', async () => {
    const prisma = createMockPrisma();
    const statsService = new ReviewStatisticsService(prisma as never);
    const service = new ReviewQueryService(prisma as never, statsService);

    const page1 = await service.findGarmentReviews('g1', { page: 1, limit: 2 });
    expect(page1.reviews.length).toBe(2);
    expect(page1.totalPages).toBe(2);
    expect(page1.page).toBe(1);

    const page2 = await service.findGarmentReviews('g1', { page: 2, limit: 2 });
    expect(page2.reviews.length).toBe(2);
    expect(page2.page).toBe(2);
  });
});

