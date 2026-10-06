import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingsService } from "./bookings.service";

const SIZE_ID = "78b73702-7516-49f3-bced-b76e6b889a11";

function createMockPrisma() {
  return {
    garment_sizes: {
      findFirst: vi.fn(),
    },
    garmentAsset: {
      count: vi.fn(),
    },
    bookingItem: {
      findMany: vi.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

describe("BookingsService.getSizeAvailabilityCalendar", () => {
  let prisma: MockPrisma;
  let service: BookingsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new BookingsService(prisma as never, {} as never, {} as never, {} as never);
  });

  it("sweeps each day with the same overlap rule as checkAvailability", async () => {
    prisma.garment_sizes.findFirst.mockResolvedValue({ id: SIZE_ID });
    prisma.garmentAsset.count.mockResolvedValue(2);
    prisma.bookingItem.findMany.mockResolvedValue([
      {
        booking: {
          rentalStartDate: new Date("2026-10-10T00:00:00.000Z"),
          rentalEndDate: new Date("2026-10-11T00:00:00.000Z"),
        },
      },
    ]);

    const result = await service.getSizeAvailabilityCalendar({
      garmentSizeId: SIZE_ID,
      fromDate: "2026-10-10",
      toDate: "2026-10-12",
    });

    expect(result.data?.capacity).toBe(2);
    expect(result.data?.days).toEqual([
      { date: "2026-10-10", available: true, availableCount: 1, capacity: 2 },
      { date: "2026-10-11", available: true, availableCount: 1, capacity: 2 },
      { date: "2026-10-12", available: true, availableCount: 2, capacity: 2 },
    ]);
  });

  it("marks days with zero availability", async () => {
    prisma.garment_sizes.findFirst.mockResolvedValue({ id: SIZE_ID });
    prisma.garmentAsset.count.mockResolvedValue(1);
    prisma.bookingItem.findMany.mockResolvedValue([
      {
        booking: {
          rentalStartDate: new Date("2026-10-10T00:00:00.000Z"),
          rentalEndDate: new Date("2026-10-10T00:00:00.000Z"),
        },
      },
    ]);

    const result = await service.getSizeAvailabilityCalendar({
      garmentSizeId: SIZE_ID,
      fromDate: "2026-10-10",
      toDate: "2026-10-11",
    });

    expect(result.data?.days).toEqual([
      { date: "2026-10-10", available: false, availableCount: 0, capacity: 1 },
      { date: "2026-10-11", available: true, availableCount: 1, capacity: 1 },
    ]);
  });

  it("throws NotFound for unknown size", async () => {
    prisma.garment_sizes.findFirst.mockResolvedValue(null);

    await expect(
      service.getSizeAvailabilityCalendar({
        garmentSizeId: SIZE_ID,
        fromDate: "2026-10-10",
        toDate: "2026-10-11",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects ranges longer than 366 days", async () => {
    prisma.garment_sizes.findFirst.mockResolvedValue({ id: SIZE_ID });

    await expect(
      service.getSizeAvailabilityCalendar({
        garmentSizeId: SIZE_ID,
        fromDate: "2026-10-01",
        toDate: "2027-10-05",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
