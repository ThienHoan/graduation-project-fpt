import { afterEach, describe, expect, it, vi } from "vitest";
import { requestChatCompletion } from "../../common/ai-chat-client";
import { requestPricingBatch, type PricingBatchItem } from "./pricing-ai-batch";

const hoisted = vi.hoisted(() => ({
  calls: [] as Array<{ systemPrompt: string; userMessage: string; maxTokens?: number }>,
}));

vi.mock("../../common/ai-chat-client", () => ({
  requestChatCompletion: vi.fn(
    async (options: { systemPrompt: string; userMessage: string; maxTokens?: number }) => {
      hoisted.calls.push({
        systemPrompt: options.systemPrompt,
        userMessage: options.userMessage,
        maxTokens: options.maxTokens,
      });
      const { items } = JSON.parse(options.userMessage) as {
        items: Array<{ key: string }>;
      };
      return JSON.stringify({
        items: items.map((item, index) => ({
          key: item.key,
          recommendedAdjustmentPct: index + 1,
          confidence: 0.8,
          reason: { demand: "+10%" },
        })),
      });
    },
  ),
}));

function item(key: string): PricingBatchItem {
  return {
    key,
    garmentName: `Mẫu ${key}`,
    basePrice: 400_000,
    purchaseCost: 1_000_000,
    demandPressure: 0.5,
    bookingPressure: 0.5,
    holidays: [],
  };
}

function sentItems(callIndex = 0): Array<{ key: string }> {
  const parsed = JSON.parse(hoisted.calls[callIndex].userMessage) as {
    items: Array<{ key: string }>;
  };
  return parsed.items;
}

afterEach(() => {
  hoisted.calls.length = 0;
  vi.mocked(requestChatCompletion).mockClear();
});

describe("requestPricingBatch", () => {
  it("trả kết quả cho tất cả key trong cùng một lô", async () => {
    const results = await requestPricingBatch([item("a"), item("b")]);

    expect(hoisted.calls).toHaveLength(1);
    expect(results.size).toBe(2);
    expect(results.get("a")?.recommendedAdjustmentPct).toBe(1);
    expect(results.get("b")?.recommendedAdjustmentPct).toBe(2);
  });

  it("gom 25 size thành 3 request thay vì 25 request", async () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`s${i}`));

    const results = await requestPricingBatch(items);

    expect(hoisted.calls).toHaveLength(3);
    expect(results.size).toBe(25);
  });

  it("lô đầu chứa đúng 10 mục đầu tiên, theo đúng thứ tự", async () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`s${i}`));

    await requestPricingBatch(items);

    const first = sentItems(0);
    expect(first).toHaveLength(10);
    expect(first[0].key).toBe("s0");
    expect(first[9].key).toBe("s9");

    const last = sentItems(2);
    expect(last).toHaveLength(5);
    expect(last[4].key).toBe("s24");
  });

  it("không trả kết quả cho size đã pending (không có trong input)", async () => {
    const results = await requestPricingBatch([item("s1"), item("s3")]);

    const keys = sentItems(0).map((i) => i.key);
    expect(keys).toEqual(["s1", "s3"]);
    expect(results.has("s2")).toBe(false);
  });

  it("bỏ qua key lạ do AI bịa", async () => {
    vi.mocked(requestChatCompletion).mockResolvedValueOnce(
      JSON.stringify({ items: [{ key: "extra", recommendedAdjustmentPct: 99 }] }),
    );

    const results = await requestPricingBatch([item("only-one")]);

    expect(results.size).toBe(0);
  });

  it("bỏ qua mục thiếu recommendedAdjustmentPct", async () => {
    vi.mocked(requestChatCompletion).mockResolvedValueOnce(
      JSON.stringify({
        items: [{ key: "no-pct" }, { key: "ok", recommendedAdjustmentPct: 15 }],
      }),
    );

    const results = await requestPricingBatch([item("no-pct"), item("ok")]);

    expect(results.size).toBe(1);
    expect(results.has("ok")).toBe(true);
  });

  it("lỗi một lô không làm hỏng lô khác", async () => {
    const items = Array.from({ length: 11 }, (_, i) => item(`s${i}`));
    vi.mocked(requestChatCompletion)
      .mockRejectedValueOnce(new Error("network fail"))
      .mockResolvedValueOnce(
        JSON.stringify({
          items: [{ key: "s10", recommendedAdjustmentPct: 7 }],
        }),
      );

    const results = await requestPricingBatch(items);

    // 11 size => 2 lô; lô 1 lỗi, lô 2 vẫn được gọi.
    expect(vi.mocked(requestChatCompletion)).toHaveBeenCalledTimes(2);
    expect(results.size).toBe(1);
    expect(results.get("s10")?.recommendedAdjustmentPct).toBe(7);
  });

  it("trả về map rỗng khi input rỗng và không gọi AI", async () => {
    const results = await requestPricingBatch([]);

    expect(results.size).toBe(0);
    expect(hoisted.calls).toHaveLength(0);
  });

  it("chịu được markdown fence trong phản hồi AI", async () => {
    vi.mocked(requestChatCompletion).mockResolvedValueOnce(
      '```json\n{"items":[{"key":"x","recommendedAdjustmentPct":33,"confidence":0.9}]}\n```',
    );

    const results = await requestPricingBatch([item("x")]);

    expect(results.get("x")?.recommendedAdjustmentPct).toBe(33);
    expect(results.get("x")?.confidence).toBe(0.9);
  });

  it("giữ nguyên hệ số âm (mùa thấp điểm)", async () => {
    vi.mocked(requestChatCompletion).mockResolvedValueOnce(
      JSON.stringify({
        items: [
          {
            key: "sale",
            recommendedAdjustmentPct: -18,
            demandPressure: 0.1,
            bookingPressure: 0.2,
            confidence: 0.75,
            reason: { demand: "-5%" },
          },
        ],
      }),
    );

    const results = await requestPricingBatch([item("sale")]);

    expect(results.get("sale")?.recommendedAdjustmentPct).toBe(-18);
    expect(results.get("sale")?.confidence).toBe(0.75);
  });

  it("gửi đầy đủ số lượng và dịp lễ trong payload", async () => {
    const holidayItem: PricingBatchItem = {
      ...item("tet"),
      holidays: [{ name: "Tết", adjustmentPercent: 20, occasionType: "holiday" }],
    };

    await requestPricingBatch([holidayItem]);

    const body = JSON.parse(hoisted.calls[0].userMessage) as {
      items: Array<{ holidays: Array<{ name: string; adjustmentPercent: number }> }>;
    };
    expect(body.items[0].holidays).toHaveLength(1);
    expect(body.items[0].holidays[0].name).toBe("Tết");
    expect(body.items[0].holidays[0].adjustmentPercent).toBe(20);
  });

  it("yêu cầu JSON, không markdown, và giới hạn token để không bị cắt", async () => {
    await requestPricingBatch([item("a")]);

    expect(hoisted.calls[0].systemPrompt).toContain("không markdown");
    expect(hoisted.calls[0].systemPrompt).toContain("BẮT BUỘC trả đủ TẤT CẢ key");
    expect(hoisted.calls[0].maxTokens).toBe(1024);
  });
});