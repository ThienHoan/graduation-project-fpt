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

function makeGarment(
  id: string,
  name: string,
  categoryId: string,
  categoryName: string,
  color: string,
  size = "M",
) {
  return {
    id,
    name,
    color,
    category: { id: categoryId, name: categoryName },
    images: [{ id: `i-${id}`, imageUrl: `https://example.com/${id}.jpg`, sortOrder: 0, garmentId: id, altText: null, createdAt: new Date() }],
    garment_sizes: [{ id: `s-${id}`, garment_id: id, size_label: size, daily_price: 300000, deposit_amount: 400000, is_active: true, created_at: new Date() }],
    assets: [{ id: `a-${id}` }],
    isActive: true,
    deletedAt: null,
    categoryId,
    description: name,
    tryonReferenceUrl: null,
    createdAt: new Date(),
    bookingItems: [],
    assets_full: [],
    tryonRequests: [],
  };
}

const MOCK_BROWSE_CATALOG = [
  makeGarment("g-1", "Áo dài đỏ thêu sen", "c-1", "Áo dài truyền thống", "đỏ"),
  makeGarment("g-2", "Áo dài xanh ngọc", "c-2", "Áo dài cách tân", "xanh"),
  makeGarment("g-3", "Cổ phục hoàng yến", "c-3", "Cổ phục", "vàng"),
  makeGarment("g-4", "Váy cưới trắng", "c-4", "Váy cưới", "trắng"),
  makeGarment("g-5", "Vest đen", "c-5", "Vest & Suit", "đen"),
  makeGarment("g-6", "Áo dài A", "c-2", "Áo dài cách tân", "hồng"),
];

/**
 * Mẫu có số đo từng size + tài sản gán theo size, dùng cho câu hỏi chọn size.
 * Size L cố tình hết hàng để kiểm tra câu "hết size này".
 */
const MEASURED_GARMENT = {
  ...makeGarment("g-7", "Áo dài đỏ thêu sen", "c-1", "Áo dài", "đỏ"),
  garment_sizes: [
    {
      id: "s-7-m", garment_id: "g-7", size_label: "M", daily_price: 350000,
      deposit_amount: 500000, is_active: true, created_at: new Date(),
      shoulder_cm: 38, bust_cm: 88, waist_cm: 70, hip_cm: 92,
      length_cm: 140, sleeve_length_cm: 55,
    },
    {
      id: "s-7-l", garment_id: "g-7", size_label: "L", daily_price: 380000,
      deposit_amount: 550000, is_active: true, created_at: new Date(),
      shoulder_cm: 40, bust_cm: 92, waist_cm: 74, hip_cm: 96,
      length_cm: 142, sleeve_length_cm: 56,
    },
  ],
  assets: [
    { id: "a-7-1", garment_size_id: "s-7-m" },
    { id: "a-7-2", garment_size_id: "s-7-m" },
  ],
};

const DEFAULT_AI_RESPONSE = {
  topics: [
    {
      title: "Gợi ý sản phẩm",
      assistantReply: "Em gợi ý các mẫu sau.",
      recommendedProductIds: ["g-2"],
      reasons: { "g-2": "Phù hợp" },
    },
  ],
};

function mockOpenRouter(aiResponse: unknown = DEFAULT_AI_RESPONSE) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(createMockOpenRouterResponse(JSON.stringify(aiResponse)))),
  } as Response);
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

function getSystemPrompt(fetchMock: ReturnType<typeof vi.fn>): string {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
  return body.messages[0].content;
}


function createMockPrisma() {
  const prisma = {
    garment: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    customerMeasurement: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
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
    // Đặt cả biến mới lẫn cũ để test không phụ thuộc nội dung backend/.env
    // (vitest nạp .env, nên nếu máy đang trỏ sang provider khác thì kết quả sẽ lệch).
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "openai/gpt-4o";
    delete process.env.AI_BASE_URL;
    delete process.env.AI_FALLBACK_MODEL;
    delete process.env.VISION_BASE_URL;
    delete process.env.VISION_API_KEY;
    delete process.env.VISION_MODEL;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    delete process.env.OPENROUTER_VISION_MODEL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
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

    it("only treats a pure greeting as small talk, not a greeting inside a product question", async () => {
      const greeting = await service.productAdvisor({ message: "chào shop" });
      expect(greeting.data?.topics[0].title).toBe("Chào hỏi");

      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createMockOpenRouterResponse(JSON.stringify({
          topics: [{
            title: "Áo dài đỏ",
            assistantReply: "Dạ shop còn mẫu áo dài đỏ ạ.",
            recommendedProductIds: ["g-1"],
            reasons: {},
          }],
        })))),
      } as Response);

      const result = await service.productAdvisor({ message: "chào shop, còn áo dài đỏ không?" });

      expect(result.data?.topics[0].title).toBe("Áo dài đỏ");
      expect(global.fetch).toHaveBeenCalledOnce();
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
      delete process.env.AI_API_KEY;
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
      ).rejects.toThrow("AI API");
    });

    it("excludes cổ phục instead of locking the query to it", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({ message: "Sản phẩm ngoài cổ phục" });

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(where.category.name.notIn).toEqual(["Cổ phục"]);
      expect(where.category.name.in).toBeUndefined();

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("KHÁCH MUỐN XEM NGOÀI");
      expect(prompt).toContain("Cổ phục");
      expect(prompt).toContain("Các danh mục hiện có");
    });

    it("does not lock to áo dài when asking what else the shop has", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({ message: "Ngoài áo dài shop còn có trang phục gì?" });

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(where.category.name.notIn).toEqual(expect.arrayContaining(["Áo dài truyền thống", "Áo dài cách tân"]));
      expect(where.category.name.in).toBeUndefined();

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("Áo dài truyền thống");
      expect(prompt).toContain("KHÁCH MUỐN DUYỆT / HỎI MỞ RỘNG");
    });

    it("keeps áo dài but excludes the red color", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({ message: "Áo dài khác ngoài áo dài đỏ" });

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(where.category.name.in).toEqual(["Áo dài truyền thống", "Áo dài cách tân"]);
      expect(where.AND).toEqual([
        { NOT: { OR: [{ color: { contains: "đỏ", mode: "insensitive" } }] } },
      ]);

      expect(getSystemPrompt(fetchMock)).toContain("màu đỏ");
    });

    it("keeps áo dài and excludes the last product card from history", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({
        message: "Áo dài khác ngoài áo dài trên",
        history: [
          {
            role: "staff",
            content: "[Thẻ sản phẩm] Áo dài đỏ thêu sen | Size: M",
            createdAt: new Date(Date.now() - 60_000).toISOString(),
          },
          {
            role: "customer",
            content: "Mẫu này còn size khác không?",
            createdAt: new Date(Date.now() - 30_000).toISOString(),
          },
        ],
      });

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).not.toContain("ID: g-1");
      expect(prompt).toContain("Áo dài đỏ thêu sen");
      expect(prompt).toContain("KHÁCH MUỐN XEM NGOÀI");
    });

    it("keeps áo dài and excludes a product matched by name", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({ message: "Áo dài khác ngoài áo dài A" });

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(where.category.name.in).toEqual(["Áo dài truyền thống", "Áo dài cách tân"]);

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).not.toContain("ID: g-6");
      expect(prompt).toContain("Áo dài A");
      expect(prompt).toContain("ID: g-2");
    });

    it("excludes the last shown cổ phục when asking for another one", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({
        message: "Cổ phục còn mẫu nào khác",
        history: [
          {
            role: "ai",
            content: "[Thẻ sản phẩm] Cổ phục hoàng yến | Size: M",
            createdAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      });

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(where.category.name.in).toEqual(["Cổ phục"]);

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).not.toContain("ID: g-3");
    });

    it("keeps only váy when the customer says not to show áo dài", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({ message: "Không cần áo dài, xem váy" });

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(where.category.name.in).toEqual(["Váy cưới"]);
      expect(where.category.name.notIn).toEqual(expect.arrayContaining(["Áo dài truyền thống", "Áo dài cách tân"]));
      expect(getSystemPrompt(fetchMock).length).toBeGreaterThan(0);
    });

    it("drops the category when the requested category has no products", async () => {
      prisma.garment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({ message: "Áo dài đỏ" });

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("KHÔNG CÓ SẢN PHẨM THUỘC LOẠI NÀY");
      expect(prisma.garment.findMany).toHaveBeenCalledTimes(3);
    });

    it("says clearly when there is nothing left outside the excluded items", async () => {
      prisma.garment.findMany.mockResolvedValue([]);

      const result = await service.productAdvisor({
        message: "Ngoài áo dài shop còn có trang phục gì?",
      });

      expect(result.data?.topics[0].title).toBe("Chưa có mẫu khác");
      expect(result.data?.topics[0].assistantReply).toContain("ngoài");
      expect(result.data?.topics[0].products).toEqual([]);
    });

    it("does not filter by the garbage keyword of a comparison question", async () => {
      // "so sánh …" từng sinh keyword "sánh" → query 0 kết quả → AI trả
      // "chưa có sản phẩm phù hợp". Router đã phân loại ai.comparison nên
      // phải bỏ keyword và giữ đủ các mẫu khách nhắc tới.
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor(
        {
          message: "so sánh mẫu áo dài đỏ thêu sen và áo dài xanh ngọc",
          intent: "ai.comparison",
        },
        true,
      );

      const where = prisma.garment.findMany.mock.calls[0][0].where as any;
      expect(JSON.stringify(where)).not.toContain("sánh");

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("LOẠI CÂU HỎI: SO SÁNH MẪU");
      expect(prompt).toContain("ID: g-1");
      expect(prompt).toContain("ID: g-2");
      // So sánh cũng dùng dạng chi tiết theo size.
      expect(prompt).toContain("chưa nhập số đo");
      expect(prompt).not.toContain("KHÔNG TÌM THẤY KEYWORD");
    });

    it("keeps the last product card in the prompt for a sizing question", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor(
        {
          message: "mẫu này size nào vừa em",
          intent: "ai.sizing",
          history: [
            {
              role: "ai",
              content: "[Thẻ sản phẩm] Cổ phục hoàng yến | Size: M",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("LOẠI CÂU HỎI: CHỌN SIZE");
      expect(prompt).toContain("ID: g-3");
      expect(prompt).not.toContain("KHÔNG TÌM THẤY KEYWORD");
    });

    it("ignores the routed intent on the public advisor endpoint", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_CATALOG as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor({
        message: "Em muốn tìm áo dài đỏ",
        intent: "ai.sizing",
        customerId: "11111111-1111-1111-1111-111111111111",
      });

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).not.toContain("LOẠI CÂU HỎI: CHỌN SIZE");
      expect(prompt).not.toContain("SỐ ĐO CỦA KHÁCH");
      expect(prisma.customerMeasurement.findFirst).not.toHaveBeenCalled();
    });

    it("sends per-size measurements, price and stock for a sizing question", async () => {
      prisma.garment.findMany.mockResolvedValue([MEASURED_GARMENT] as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor(
        {
          message: "mẫu này size nào vừa em",
          intent: "ai.sizing",
          history: [
            {
              role: "ai",
              content: "[Thẻ sản phẩm] Áo dài đỏ thêu sen | Size: M",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("số đo vai 38, ngực 88, eo 70, hông 92, dài 140, tay 55 (cm)");
      // toLocaleString phụ thuộc locale máy chạy test → so khớp cả "350.000" và "350,000".
      expect(prompt).toMatch(/350[.,]000đ\/ngày/);
      expect(prompt).toMatch(/cọc 500[.,]000đ/);
      expect(prompt).toContain("còn 2");
      expect(prompt).toContain("hết size này");
    });

    it("includes stored customer measurements in a sizing prompt", async () => {
      prisma.garment.findMany.mockResolvedValue([MEASURED_GARMENT] as any);
      prisma.customerMeasurement.findFirst.mockResolvedValue({
        heightCm: 160,
        weightKg: 50,
        bustCm: 84,
        waistCm: 66,
        hipCm: 90,
        usualSize: "M",
      });
      const fetchMock = mockOpenRouter();

      await service.productAdvisor(
        {
          message: "mẫu này size nào vừa em",
          intent: "ai.sizing",
          customerId: "11111111-1111-1111-1111-111111111111",
          history: [
            {
              role: "ai",
              content: "[Thẻ sản phẩm] Áo dài đỏ thêu sen | Size: M",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("SỐ ĐO CỦA KHÁCH");
      expect(prompt).toContain(
        "cao 160cm, nặng 50kg, ngực 84cm, eo 66cm, hông 90cm, size thường mặc M",
      );
      expect(prisma.customerMeasurement.findFirst).toHaveBeenCalledOnce();
    });

    it("does not force 3-4 products for a sizing question", async () => {
      prisma.garment.findMany.mockResolvedValue([MEASURED_GARMENT] as any);
      const fetchMock = mockOpenRouter();

      await service.productAdvisor(
        {
          message: "mẫu này size nào vừa em",
          intent: "ai.sizing",
          history: [
            {
              role: "ai",
              content: "[Thẻ sản phẩm] Áo dài đỏ thêu sen | Size: M",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).not.toContain("LUÔN đề xuất 3-4 sản phẩm");
      expect(prompt).not.toContain("phải chứa 3-4 ID sản phẩm");
      expect(prompt).toContain("KHÔNG thêm mẫu khác chỉ để đủ số lượng");
      // Được phép hỏi lại đúng một câu khi thiếu số đo của khách.
      expect(prompt).toContain("hỏi lại đúng MỘT câu");
      expect(prompt).toContain("1. Nếu ĐÃ CÓ số đo của khách");
      expect(prompt).toContain("3. Nếu size phù hợp đã hết");
    });

    it("does not force 3-4 ids for a comparison question", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter({
        topics: [
          {
            title: "So sánh",
            assistantReply: "Hai mẫu khác nhau ở màu và giá.",
            recommendedProductIds: ["g-1", "g-2"],
            reasons: {},
          },
        ],
      });

      const result = await service.productAdvisor(
        {
          message: "so sánh áo dài đỏ thêu sen và áo dài xanh ngọc",
          intent: "ai.comparison",
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).not.toContain("phải chứa 3-4 ID sản phẩm");
      expect(prompt).toContain("recommendedProductIds chỉ chứa đúng các mẫu đã so sánh");
      expect(prompt).toContain("1. ID: g-1");
      expect(prompt).toContain("2. ID: g-2");
      // Response trả 2 ID thì giữ đúng 2, không bị điền thêm.
      expect(result.data?.topics[0].recommendedProductIds).toEqual(["g-1", "g-2"]);
    });

    it("does not invent a second product when only one comparison target exists", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter({
        topics: [
          {
            title: "So sánh",
            assistantReply: "Shop chưa có mẫu tím nên chưa thể so sánh.",
            // Model cố trả thêm mẫu thứ hai không được so sánh.
            recommendedProductIds: ["g-1", "g-2"],
            reasons: {},
          },
        ],
      });

      const result = await service.productAdvisor(
        {
          message: "so sánh áo dài đỏ thêu sen với áo dài tím",
          intent: "ai.comparison",
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("KHÔNG TÌM THẤY MẪU ĐỂ SO SÁNH");
      expect(prompt).toContain("áo dài tím");
      expect(prompt).toContain("TUYỆT ĐỐI không tự thêm một sản phẩm khác");
      // Chỉ đúng 1 mẫu được đưa vào prompt, không bù mẫu thứ hai.
      expect(prompt.match(/ID: g-/g)).toHaveLength(1);
      expect(prompt).not.toContain("ID: g-2");
      // Card/ID trả về cũng bị giới hạn trong catalog đã chọn.
      expect(result.data?.topics[0].recommendedProductIds).toEqual(["g-1"]);
    });

    it("keeps a single history product for a comparison without topping up", async () => {
      prisma.garment.findMany.mockResolvedValue(MOCK_BROWSE_CATALOG as any);
      const fetchMock = mockOpenRouter({
        topics: [
          {
            title: "So sánh",
            assistantReply: "Shop mới xác định được một mẫu.",
            recommendedProductIds: ["g-3"],
            reasons: {},
          },
        ],
      });

      const result = await service.productAdvisor(
        {
          message: "so sánh mẫu này với mẫu kia",
          intent: "ai.comparison",
          history: [
            {
              role: "ai",
              content: "[Thẻ sản phẩm] Cổ phục hoàng yến | Size: M",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        true,
      );

      const prompt = getSystemPrompt(fetchMock);
      expect(prompt).toContain("ID: g-3");
      expect(prompt.match(/ID: g-/g)).toHaveLength(1);
      expect(prompt).toContain("Nếu chỉ có 1 mẫu để so sánh");
      expect(result.data?.topics[0].recommendedProductIds).toEqual(["g-3"]);
    });

    it("replies deterministically when the shop has no product to compare", async () => {
      prisma.garment.findMany.mockResolvedValue([] as any);
      const fetchMock = mockOpenRouter();

      const result = await service.productAdvisor(
        {
          message: "so sánh áo dài đỏ với áo dài tím",
          intent: "ai.comparison",
        },
        true,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.data?.topics[0].title).toBe("Chưa có mẫu để so sánh");
      expect(result.data?.topics[0].assistantReply).toContain("áo dài tím");
      expect(result.data?.topics[0].recommendedProductIds).toEqual([]);
    });
  });

  describe("createTryon & Caching & Queue", () => {
    const validBase64 = Buffer.alloc(12000, 42).toString("base64");
    const validImageUri = `data:image/jpeg;base64,${validBase64}`;

    it("returns cached result immediately when identical request was completed before (Cache HIT)", async () => {
      const mockGarmentSize = {
        id: "size-1",
        garment_id: "g-1",
        size_label: "M",
        is_active: true,
        garments: {
          name: "Áo dài đỏ thêu sen",
          tryonReferenceUrl: "https://example.com/model.jpg",
          images: [],
          category: { tryonCategory: "dresses" },
        },
      };

      const mockCachedResult = {
        id: "res-cached-1",
        storedImageUrl: "https://example.com/cached-result.png",
        resultImageUrl: "https://replicate.delivery/cached.png",
        aiMetadata: { model: "cdingram/face-swap" },
      };

      prisma.garment_sizes = {
        findFirst: vi.fn().mockResolvedValue(mockGarmentSize),
      };
      prisma.tryonResult = {
        findFirst: vi.fn().mockResolvedValue(mockCachedResult),
        create: vi.fn().mockResolvedValue({ id: "res-new-1" }),
      };
      prisma.tryonRequest = {
        create: vi.fn().mockResolvedValue({ id: "req-new-1" }),
      };

      const result = await service.createTryon(
        {
          garmentSizeId: "size-1",
          mode: "face_swap",
          imageBase64: validImageUri,
        },
        "customer-1",
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("completed");
      expect(result.data?.isCached).toBe(true);
      expect(result.data?.resultImageUrl).toBe("https://example.com/cached-result.png");
      expect(prisma.tryonResult.create).toHaveBeenCalled();
    });

    it("dispatches job to TryonQueueService when cache misses and queue is configured", async () => {
      const mockGarmentSize = {
        id: "size-1",
        garment_id: "g-1",
        size_label: "M",
        is_active: true,
        garments: {
          name: "Áo dài đỏ thêu sen",
          tryonReferenceUrl: "https://example.com/model.jpg",
          images: [],
          category: { tryonCategory: "dresses" },
        },
      };

      const mockQueue = {
        setHandlers: vi.fn(),
        addJob: vi.fn(),
        getQueuePosition: vi.fn().mockReturnValue(1),
      } as any;

      prisma.garment_sizes = {
        findFirst: vi.fn().mockResolvedValue(mockGarmentSize),
      };
      prisma.tryonResult = {
        findFirst: vi.fn().mockResolvedValue(null), // Cache MISS
      };
      prisma.tryonRequest = {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "req-pending-1" }),
      };

      const serviceWithQueue = new AiService(prisma as never, createMockPricing(), mockQueue);

      const result = await serviceWithQueue.createTryon(
        {
          garmentSizeId: "size-1",
          mode: "face_swap",
          imageBase64: validImageUri,
        },
        "customer-1",
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("pending");
      expect(result.data?.isCached).toBe(false);
      expect(result.data?.queuePosition).toBe(1);
      expect(mockQueue.addJob).toHaveBeenCalled();
    });

    it("returns correct status and queue position from getTryonStatus", async () => {
      prisma.tryonRequest = {
        findFirst: vi.fn().mockResolvedValue({
          id: "req-1",
          status: "pending",
          mode: "face_swap",
          garment: { name: "Áo dài thêu sen" },
          results: [],
          completedAt: null,
          errorMessage: null,
        }),
      };

      const mockQueue = {
        getQueuePosition: vi.fn().mockReturnValue(2),
      } as any;

      const serviceWithQueue = new AiService(prisma as never, createMockPricing(), mockQueue);
      const res = await serviceWithQueue.getTryonStatus("req-1", "customer-1");

      expect(res.success).toBe(true);
      expect(res.data?.status).toBe("pending");
      expect(res.data?.queuePosition).toBe(2);
    });
  });
});
