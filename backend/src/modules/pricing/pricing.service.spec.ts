import { describe, expect, it, vi } from "vitest";
import { PricingService } from "./pricing.service";

const BASE_DTO = {
  name: "Tết Nguyên Đán",
  occasionType: "holiday",
  fromDate: "2027-02-01",
  toDate: "2027-02-07",
};

function calendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal-1",
    name: "Tết Nguyên Đán",
    occasion_type: "holiday",
    from_date: new Date("2027-02-01T00:00:00.000Z"),
    to_date: new Date("2027-02-07T00:00:00.000Z"),
    adjustment_percent: 10,
    priority: 0,
    apply_all: true,
    target_garment_ids: [],
    is_active: true,
    note: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeService(existing: Record<string, unknown> | null = null) {
  const prisma = {
    price_calendar: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
        calendarRow(data),
      ),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
        calendarRow({ ...(existing ?? {}), ...data }),
      ),
    },
  };
  return {
    prisma,
    service: new PricingService(prisma as never, {} as never),
  };
}

describe("PricingService.createCalendar", () => {
  it("lưu phạm vi sản phẩm cụ thể", async () => {
    const { prisma, service } = makeService();

    const result = await service.createCalendar({
      ...BASE_DTO,
      applyAll: false,
      targetGarmentIds: ["gar-1", "gar-1", " gar-2 "],
    });

    expect(prisma.price_calendar.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apply_all: false,
          target_garment_ids: ["gar-1", "gar-2"],
        }),
      }),
    );
    expect(result.data).toMatchObject({
      applyAll: false,
      targetGarmentIds: ["gar-1", "gar-2"],
    });
  });

  it("mặc định áp dụng tất cả khi không chọn gì", async () => {
    const { prisma, service } = makeService();

    await service.createCalendar({ ...BASE_DTO });

    expect(prisma.price_calendar.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apply_all: true,
          target_garment_ids: [],
        }),
      }),
    );
  });

  it("báo lỗi khi tắt áp dụng tất cả mà không chọn sản phẩm", async () => {
    const { prisma, service } = makeService();

    await expect(
      service.createCalendar({ ...BASE_DTO, applyAll: false }),
    ).rejects.toThrow("chọn ít nhất một sản phẩm");
    expect(prisma.price_calendar.create).not.toHaveBeenCalled();
  });
});

describe("PricingService.listCalendar", () => {
  function makeListService() {
    const prisma = {
      price_calendar: {
        findMany: vi.fn().mockResolvedValue([calendarRow()]),
        count: vi.fn().mockResolvedValue(1),
      },
    };
    return { prisma, service: new PricingService(prisma as never, {} as never) };
  }

  it("mặc định chỉ trả sự kiện đang bật", async () => {
    const { prisma, service } = makeListService();

    await service.listCalendar();

    expect(prisma.price_calendar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ is_active: true }) }),
    );
  });

  it("trả cả sự kiện đã tắt khi includeInactive=true", async () => {
    const { prisma, service } = makeListService();

    await service.listCalendar({ includeInactive: true });

    const arg = prisma.price_calendar.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where.is_active).toBeUndefined();
  });
});

describe("PricingService.removeCalendar", () => {
  function makeRemoveService(pendingCount: number) {
    const prisma = {
      price_calendar: {
        findUnique: vi.fn().mockResolvedValue(calendarRow()),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
          calendarRow(data),
        ),
      },
      price_suggestions: {
        count: vi.fn().mockResolvedValue(pendingCount),
      },
    };
    return { prisma, service: new PricingService(prisma as never, {} as never) };
  }

  it("chặn ẩn khi còn đề xuất chờ duyệt", async () => {
    const { prisma, service } = makeRemoveService(3);

    await expect(service.removeCalendar("cal-1")).rejects.toThrow(
      "còn 3 đề xuất chờ duyệt",
    );
    expect(prisma.price_calendar.update).not.toHaveBeenCalled();
  });

  it("ẩn được khi không còn đề xuất chờ duyệt", async () => {
    const { prisma, service } = makeRemoveService(0);

    const result = await service.removeCalendar("cal-1");

    expect(prisma.price_calendar.update).toHaveBeenCalledWith({
      where: { id: "cal-1" },
      data: { is_active: false },
    });
    expect(result.data).toMatchObject({ id: "cal-1", deactivated: true });
  });
});

describe("PricingService.listSuggestions", () => {
  function makeSuggestionsService() {
    const prisma = {
      price_suggestions: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    return { prisma, service: new PricingService(prisma as never, {} as never) };
  }

  it("tìm theo tên sự kiện (OR với sản phẩm / size)", async () => {
    const { prisma, service } = makeSuggestionsService();

    await service.listSuggestions({ search: "Tết" });

    const arg = prisma.price_suggestions.findMany.mock.calls[0][0] as {
      where: { OR?: Array<Record<string, unknown>> };
    };
    expect(arg.where.OR).toEqual(
      expect.arrayContaining([
        { price_calendar: { name: { contains: "Tết", mode: "insensitive" } } },
      ]),
    );
  });
});

describe("PricingService.updateCalendar", () => {
  it("cập nhật phạm vi sản phẩm mới", async () => {
    const { prisma, service } = makeService(
      calendarRow({ apply_all: false, target_garment_ids: ["gar-1"] }),
    );

    await service.updateCalendar("cal-1", {
      targetGarmentIds: ["gar-2"],
    });

    expect(prisma.price_calendar.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apply_all: false,
          target_garment_ids: ["gar-2"],
        }),
      }),
    );
  });

  it("chuyển sang áp dụng tất cả", async () => {
    const { prisma, service } = makeService(
      calendarRow({ apply_all: false, target_garment_ids: ["gar-1"] }),
    );

    await service.updateCalendar("cal-1", { applyAll: true });

    expect(prisma.price_calendar.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ apply_all: true }),
      }),
    );
  });
});
