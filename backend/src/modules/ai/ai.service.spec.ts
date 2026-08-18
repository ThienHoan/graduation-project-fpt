import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AiService } from "./ai.service";

const MOCK_CATALOG = [
  {
    id: "g-1",
    name: "Áo dài đỏ thêu sen",
    color: "đỏ",
    category: { id: "c-1", name: "Áo dài" },
    images: [{ id: "i-1", imageUrl: "https://example.com/1.jpg", sortOrder: 0, garmentId: "g-1", altText: null, createdAt: new Date() }],
    garment_sizes: [{ id: "s-1", garment_id: "g-1", size_label: "M", daily_price: 350000, deposit_amount: 500000, is_active: true, created_at: new Date() }],
    assets: [{ id: "a-1" }],
    isActive: true,
    deletedAt: null,
    categoryId: "c-1",
    description: "Áo dài đỏ thêu hoa sen",
    tryonReferenceUrl: null,
    createdAt: new Date(),
    bookingItems: [],
    assets_full: [],
    tryonRequests: [],
  },
  {
    id: "g-2",
    name: "Áo dài xanh ngọc",
    color: "xanh",
    category: { id: "c-1", name: "Áo dài" },
    images: [{ id: "i-2", imageUrl: "https://example.com/2.jpg", sortOrder: 0, garmentId: "g-2", altText: null, createdAt: new Date() }],
    garment_sizes: [{ id: "s-2", garment_id: "g-2", size_label: "S", daily_price: 300000, deposit_amount: 400000, is_active: true, created_at: new Date() }],
    assets: [{ id: "a-2" }],
    isActive: true,
    deletedAt: null,
    categoryId: "c-1",
    description: "Áo dài xanh ngọc",
    tryonReferenceUrl: null,
    createdAt: new Date(),
    bookingItems: [],
    assets_full: [],
    tryonRequests: [],
  },
];

function createMockPrisma() {
  const prisma = {
    garment: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  } as any;
  return prisma;
}

function createMockPricing() {
  return {
    effectiveDailyPriceMap: vi.fn(async () => new Map()),
  } as any;
}

function createMockOpenRouterResponse(content: string) {
  return {
    id: "test-id",
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

describe("AiService", () => {
  let service: AiService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    prisma = createMockPrisma();
    service = new AiService(prisma as never, createMockPricing());
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test-key";
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  describe("productAdvisor", () => {
    it("returns 'Không tìm thấy' topic when catalog is empty", async () => {
      prisma.garment.findMany.mockResolvedValue([]);

      const result = await service.productAdvisor({
        message: "Em muốn tìm áo dài đỏ",
      });

      expect(result.data?.topics).toHaveLength(1);
      expect(result.data?.topics[0].title).toBe("Không tìm thấy");
      expect(result.data?.topics[0].products).toEqual([]);
    });

    it("returns parsed topics from OpenRouter response", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);

      const aiResponse = {
        topics: [
          {
            title: "Áo dài đỏ",
            assistantReply: "Mình gợi ý áo dài đỏ thêu sen rất hợp với nhu cầu của bạn.",
            recommendedProductIds: ["g-1"],
            reasons: { "g-1": "Màu đỏ nổi bật, hợp chụp kỷ yếu" },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createMockOpenRouterResponse(JSON.stringify(aiResponse)))),
      } as Response);

      const result = await service.productAdvisor({
        message: "Em muốn tìm áo dài đỏ chụp kỷ yếu",
      });

      expect(result.data?.topics).toHaveLength(1);
      expect(result.data?.topics[0].title).toBe("Áo dài đỏ");
      expect(result.data?.topics[0].assistantReply).toBe(
        "Mình gợi ý áo dài đỏ thêu sen rất hợp với nhu cầu của bạn.",
      );
      expect(result.data?.topics[0].recommendedProductIds).toEqual(["g-1"]);
      expect((result.data?.topics[0].reasons as Record<string, string>)["g-1"]).toBe("Màu đỏ nổi bật, hợp chụp kỷ yếu");
    });

    it("filters out product IDs not in catalog", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);

      const aiResponse = {
        topics: [
          {
            title: "Sản phẩm",
            assistantReply: "Cả hai sản phẩm đều phù hợp.",
            recommendedProductIds: ["g-1", "g-999"],
            reasons: { "g-1": "Đẹp", "g-999": "Cũng đẹp" },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createMockOpenRouterResponse(JSON.stringify(aiResponse)))),
      } as Response);

      const result = await service.productAdvisor({
        message: "Tôi cần 2 áo dài",
      });

      expect(result.data?.topics[0].recommendedProductIds).toEqual(["g-1"]);
    });

    it("returns helper topic when intent is not search (other)", async () => {
      const result = await service.productAdvisor({
        message: "Câu hỏi kỳ lạ",
      });

      expect(result.data?.topics).toHaveLength(1);
      expect(result.data?.topics[0].title).toBe("Bạn cần tìm gì?");
      expect(result.data?.topics[0].products).toEqual([]);
    });

    it("limits topics to 3", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);

      const topics = Array.from({ length: 5 }, (_, i) => ({
        title: `Topic ${i + 1}`,
        assistantReply: `Reply ${i + 1}`,
        recommendedProductIds: [] as string[],
        reasons: {} as Record<string, string>,
      }));

      const aiResponse = { topics };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createMockOpenRouterResponse(JSON.stringify(aiResponse)))),
      } as Response);

      const result = await service.productAdvisor({
        message: "Có gì đẹp?",
      });

      expect(result.data?.topics.length).toBeLessThanOrEqual(3);
    });

    it("throws when API key is missing", async () => {
      delete process.env.OPENROUTER_API_KEY;
      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);

      await expect(
        service.productAdvisor({ message: "Có gì đẹp?" }),
      ).rejects.toThrow("OPENROUTER_API_KEY not configured");
    });

    it("throws on OpenRouter API error", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      } as Response);

      await expect(
        service.productAdvisor({ message: "Có gì đẹp?" }),
      ).rejects.toThrow("OpenRouter API");
    });
  });
});
