import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ReviewsService } from "./reviews.service";

describe("ReviewsService", () => {
  const createMockPrisma = () => ({
    booking: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    review: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  });

  const mockNotifications = {
    notifyUser: vi.fn().mockResolvedValue(undefined),
  };

  it("creates a review with fit feedback and clean comment successfully", async () => {
    const prisma = createMockPrisma();
    prisma.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      customerId: "customer-1",
      status: "completed",
      items: [{ garmentId: "garment-1" }],
    });
    prisma.review.findUnique.mockResolvedValue(null);
    prisma.review.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "review-1",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const service = new ReviewsService(prisma as never, mockNotifications as never);
    const result = await service.create("customer-1", {
      garmentId: "garment-1",
      bookingId: "booking-1",
      rating: 5,
      comment: "Áo dài rất đẹp và đường may tinh xảo",
      fitFeedback: "true_to_size",
    });

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: "customer-1",
        garmentId: "garment-1",
        bookingId: "booking-1",
        rating: 5,
        comment: "[FIT:true_to_size] Áo dài rất đẹp và đường may tinh xảo",
        isReported: false,
      }),
    });
    expect(result.data!.fitFeedback).toBe("true_to_size");
    expect(result.data!.comment).toBe("Áo dài rất đẹp và đường may tinh xảo");
  });

  it("blocks review creation if comment contains severe toxic language (AI Moderation)", async () => {
    const prisma = createMockPrisma();
    const service = new ReviewsService(prisma as never, mockNotifications as never);

    await expect(
      service.create("customer-1", {
        garmentId: "garment-1",
        bookingId: "booking-1",
        rating: 1,
        comment: "Đồ như đm lừa đảo vcl",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it("automatically flags suspicious review containing spam links (AI Moderation)", async () => {
    const prisma = createMockPrisma();
    prisma.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      customerId: "customer-1",
      status: "returned",
      items: [{ garmentId: "garment-1" }],
    });
    prisma.review.findUnique.mockResolvedValue(null);
    prisma.review.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "review-2",
        ...data,
      }),
    );

    const service = new ReviewsService(prisma as never, mockNotifications as never);
    await service.create("customer-1", {
      garmentId: "garment-1",
      bookingId: "booking-1",
      rating: 5,
      comment: "Xem thêm bộ sưu tập khác tại https://my-external-shop.com nhé mọi người",
    });

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isReported: true,
        reportedReason: expect.stringContaining("link liên kết"),
      }),
    });
  });

  it("rejects review if booking is not completed or returned", async () => {
    const prisma = createMockPrisma();
    prisma.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      customerId: "customer-1",
      status: "renting", // Still renting!
      items: [{ garmentId: "garment-1" }],
    });

    const service = new ReviewsService(prisma as never, mockNotifications as never);
    await expect(
      service.create("customer-1", {
        garmentId: "garment-1",
        bookingId: "booking-1",
        rating: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("calculates statistics and filters reviews properly in findAllByGarment", async () => {
    const prisma = createMockPrisma();
    prisma.review.findMany.mockResolvedValue([
      {
        id: "r1",
        rating: 5,
        comment: "[FIT:true_to_size] Rất vừa vặn",
        images: ["img1.jpg"],
        video: null,
        customer: { id: "c1", email: "c1@test.com", profile: { fullName: "User 1" } },
      },
      {
        id: "r2",
        rating: 4,
        comment: "[FIT:tight] Hơi chật ngực một chút",
        images: [],
        video: null,
        customer: { id: "c2", email: "c2@test.com", profile: { fullName: "User 2" } },
      },
      {
        id: "r3",
        rating: 5,
        comment: "Tuyệt vời",
        images: [],
        video: null,
        customer: { id: "c3", email: "c3@test.com", profile: { fullName: "User 3" } },
      },
    ]);

    const service = new ReviewsService(prisma as never, mockNotifications as never);

    // 1. All reviews
    const all = await service.findAllByGarment("garment-1");
    expect(all.data!.total).toBe(3);
    expect(all.data!.averageRating).toBe(4.7);
    expect(all.data!.ratingCounts[5]).toBe(2);
    expect(all.data!.ratingCounts[4]).toBe(1);
    expect(all.data!.fitCounts.true_to_size).toBe(1);
    expect(all.data!.fitCounts.tight).toBe(1);
    expect(all.data!.mediaCount).toBe(1);

    // 2. Filter by media only
    const mediaOnly = await service.findAllByGarment("garment-1", { hasMedia: true });
    expect(mediaOnly.data!.filteredTotal).toBe(1);
    expect(mediaOnly.data!.reviews[0].id).toBe("r1");

    // 3. Filter by rating 4
    const rating4 = await service.findAllByGarment("garment-1", { rating: 4 });
    expect(rating4.data!.filteredTotal).toBe(1);
    expect(rating4.data!.reviews[0].id).toBe("r2");
  });

  it("rejects editing a locked review", async () => {
    const prisma = createMockPrisma();
    prisma.review.findUnique.mockResolvedValue({
      id: "r-locked",
      customerId: "c1",
      isLocked: true,
    });

    const service = new ReviewsService(prisma as never, mockNotifications as never);
    await expect(
      service.update("r-locked", "c1", { rating: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
