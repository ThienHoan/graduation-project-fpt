import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLOR_SYNONYMS } from "../ai/utils/filter-extractor";
import { normalizeForMatch } from "../ai/utils/query-scope";
import { AiService } from "../ai/ai.service";
import { buildProductCardPayload } from "./product-card-payload";

/**
 * Integration test chỉ chạy khi có DB test riêng. Mặc định bị skip để CI/local
 * không bao giờ chạm database thật.
 *
 * Cách chạy:
 *   RUN_DB_INTEGRATION_TESTS=1 \
 *   TEST_DATABASE_URL="postgresql://.../shop_test" \
 *   npx vitest run src/modules/chat/product-card-payload.integration.spec.ts
 *
 * An toàn: từ chối chạy nếu TEST_DATABASE_URL trùng DATABASE_URL hoặc trông
 * giống production. Toàn bộ test chỉ đọc (findFirst/findMany), không ghi/xoá.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();
const APP_DATABASE_URL = process.env.DATABASE_URL?.trim();

const INTEGRATION_ENABLED =
  process.env.RUN_DB_INTEGRATION_TESTS === "1" &&
  Boolean(TEST_DATABASE_URL) &&
  TEST_DATABASE_URL !== APP_DATABASE_URL &&
  !/prod|production/i.test(TEST_DATABASE_URL ?? "");

const describeDb = INTEGRATION_ENABLED ? describe : describe.skip;

describeDb("Chat product card / AI catalog (DB integration)", () => {
  let prisma: PrismaClient;
  let service: AiService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DATABASE_URL } },
    });
    await prisma.$connect();
    // Pricing chỉ cần trả map rỗng: test không dùng giá theo mùa.
    service = new AiService(prisma as never, {
      effectiveDailyPriceMap: async () => new Map<string, number>(),
    } as never);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("builds a rich card payload from a real garment", async (ctx) => {
    const garment = await prisma.garment.findFirst({
      where: { isActive: true },
      include: {
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        garment_sizes: {
          where: { is_active: true },
          orderBy: { daily_price: "asc" },
        },
        assets: {
          where: { status: "available" },
          select: { id: true, garment_size_id: true },
        },
        category: { select: { name: true } },
      },
    });

    if (!garment) {
      ctx.skip();
      return;
    }

    const product = buildProductCardPayload(garment);

    expect(product.id).toBe(garment.id);
    expect(product.name).toBe(garment.name);
    expect(product.detailUrl).toMatch(/^\/catalog\//);
    expect(product.sizes).toEqual(
      expect.arrayContaining(
        garment.garment_sizes
          .map((size) => size.size_label)
          .filter((label): label is string => Boolean(label)),
      ),
    );

    const prices = garment.garment_sizes
      .map((size) => Number(size.daily_price))
      .filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length > 0) {
      expect(product.price).toBe(Math.min(...prices));
      expect(product.priceTo).toBe(Math.max(...prices));
    }

    // Tồn kho chỉ được kết luận khi thật sự có tài sản gán/không gán theo size.
    if (garment.assets.length === 0) {
      expect(product.inStock).toBe(false);
    } else {
      expect(product.inStock).toBe(true);
    }
  });

  it("returns per-size measurements and stock from queryCatalog", async (ctx) => {
    const serviceAny = service as unknown as {
      queryCatalog: (filters?: Record<string, unknown>, onDate?: Date, browse?: boolean) => Promise<
        Array<{
          garmentId: string;
          sizeDetails?: Array<{
            label: string;
            dailyPrice: number;
            depositAmount: number;
            stock: number | null;
            measurements: string;
          }>;
        }>
      >;
    };

    const catalog = await serviceAny.queryCatalog({}, undefined, true);
    if (catalog.length === 0) {
      ctx.skip();
      return;
    }

    for (const product of catalog.slice(0, 5)) {
      expect(Array.isArray(product.sizeDetails)).toBe(true);
      for (const size of product.sizeDetails ?? []) {
        expect(size.label.length).toBeGreaterThan(0);
        expect(size.dailyPrice).toBeGreaterThanOrEqual(0);
        expect(size.depositAmount).toBeGreaterThanOrEqual(0);
        expect(size.stock === null || size.stock >= 0).toBe(true);
        expect(typeof size.measurements).toBe("string");
      }
    }
  });

  it("selects the exact two garments named in a comparison question", async (ctx) => {
    const garments = await prisma.garment.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      take: 2,
      orderBy: { createdAt: "asc" },
    });
    if (garments.length < 2) {
      ctx.skip();
      return;
    }

    const serviceAny = service as unknown as {
      selectAiIntentCatalog: (
        aiIntent: string,
        message: string,
        history?: Array<{ role: string; content: string; createdAt: string }>,
      ) => Promise<{
        products: Array<{ garmentId: string }>;
        missingTargets: string[];
      }>;
    };

    const selection = await serviceAny.selectAiIntentCatalog(
      "ai.comparison",
      `so sánh ${garments[0].name} và ${garments[1].name}`,
      [],
    );

    const ids = selection.products.map((product) => product.garmentId);
    expect(ids).toEqual(expect.arrayContaining([garments[0].id, garments[1].id]));
    expect(selection.missingTargets).toEqual([]);
  });

  it("reports a missing comparison target instead of inventing a second garment", async (ctx) => {
    const first = await prisma.garment.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (!first) {
      ctx.skip();
      return;
    }

    const colors = await prisma.garment.findMany({
      where: { isActive: true, color: { not: null } },
      select: { color: true },
      distinct: ["color"],
    });
    const existingColors = new Set(
      colors
        .map((row) => normalizeForMatch(row.color ?? ""))
        .filter((color) => color.length > 0),
    );
    const missingColor = Object.keys(COLOR_SYNONYMS).find(
      (color) => !existingColors.has(normalizeForMatch(color)),
    );
    if (!missingColor) {
      // DB test đang có đủ mọi màu → không dựng được case thiếu mẫu.
      ctx.skip();
      return;
    }

    const serviceAny = service as unknown as {
      selectAiIntentCatalog: (
        aiIntent: string,
        message: string,
        history?: Array<{ role: string; content: string; createdAt: string }>,
      ) => Promise<{
        products: Array<{ garmentId: string }>;
        missingTargets: string[];
      }>;
    };

    const selection = await serviceAny.selectAiIntentCatalog(
      "ai.comparison",
      `so sánh ${first.name} với áo dài ${missingColor}`,
      [],
    );

    expect(selection.products.map((product) => product.garmentId)).toContain(first.id);
    expect(selection.missingTargets).toHaveLength(1);
    expect(selection.missingTargets[0]).toContain(missingColor);
  });

  it("formats stored customer measurements for the sizing prompt", async (ctx) => {
    const measurement = await prisma.customerMeasurement.findFirst({
      where: { OR: [{ heightCm: { not: null } }, { usualSize: { not: null } }] },
      select: { customerId: true },
      orderBy: { createdAt: "desc" },
    });
    if (!measurement) {
      ctx.skip();
      return;
    }

    const serviceAny = service as unknown as {
      loadCustomerMeasurements: (customerId?: string) => Promise<string | null>;
    };

    const text = await serviceAny.loadCustomerMeasurements(measurement.customerId);
    expect(text).toBeTruthy();
    expect(text).toMatch(/cao |size thường mặc /);
    expect(text).not.toContain("NaN");
  });
});
