import { Logger } from "@nestjs/common";
import { requestChatCompletion } from "../../common/ai-chat-client";

/**
 * Gọi AI định giá cho NHIỀU size trong MỘT request.
 *
 * Lý do: free tier Gemini chỉ cho ~20 request/ngày. Gọi từng size như trước
 * (20-30 lời gọi) sẽ hết quota chỉ sau một lần bấm "Sinh đề xuất". Batch lại
 * để 1 lần bấm chỉ tốn vài request, đồng thời nhanh hơn nhiều.
 */

export type PricingBatchItem = {
  key: string;
  garmentName: string;
  basePrice: number;
  purchaseCost: number;
  demandPressure: number;
  bookingPressure: number;
  holidays: Array<{ name: string; adjustmentPercent: number; occasionType: string }>;
};

export type PricingBatchResult = {
  key: string;
  recommendedAdjustmentPct: number;
  demandPressure?: number;
  bookingPressure?: number;
  confidence?: number;
  reason?: Record<string, string>;
};

const logger = new Logger("PricingAiBatch");

const SYSTEM_PROMPT = [
  "Bạn là chuyên gia định giá cho cửa hàng cho thuê áo dài và trang phục truyền thống Việt Nam.",
  "Bạn nhận danh sách NHIỀU trang phục (mỗi mục có key duy nhất) kèm dữ liệu kinh doanh.",
  "Với MỖI mục, trả về MỨC ĐIỀU CHỈNH TƯƠNG ĐỐI (phần trăm) so với giá gốc — KHÔNG trả giá tiền tuyệt đối.",
  "demandPressure: -1 = giảm mạnh, 0 = bình thường, +1 = tăng gấp đôi.",
  "bookingPressure: 0 = còn trống, 1 = kín sạch.",
  "Tổng hợp dịp lễ + nhu cầu + đặt trước, giữ mức cân bằng, tránh tăng quá gắt.",
  "Trả về JSON hợp lệ, không markdown, không giải thích, đúng format:",
  '{"items":[{"key":"<key đã cho>","recommendedAdjustmentPct":18,"demandPressure":0.8,"bookingPressure":0.8,"confidence":0.87,"reason":{"demand":"+10%","booking":"+5%","holiday":"+3%","season":"0%"}}]}',
  "BẮT BUỘC trả đủ TẤT CẢ key được yêu cầu, giữ nguyên chuỗi key.",
].join("\n");

/** Số mục tối đa trong 1 request — đủ nhỏ để JSON không bị cắt. */
const BATCH_SIZE = 10;

function parseItems(content: string): Map<string, PricingBatchResult> {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { items?: unknown };
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const map = new Map<string, PricingBatchResult>();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key : undefined;
    if (!key) continue;

    const pct = Number(item.recommendedAdjustmentPct);
    if (!Number.isFinite(pct)) continue;

    const num = (name: string): number | undefined =>
      typeof item[name] === "number" && Number.isFinite(item[name] as number)
        ? (item[name] as number)
        : undefined;

    map.set(key, {
      key,
      recommendedAdjustmentPct: pct,
      demandPressure: num("demandPressure") ?? num("demandScore"),
      bookingPressure: num("bookingPressure") ?? num("inventoryPressure") ?? num("inventoryScore"),
      confidence: num("confidence"),
      reason:
        item.reason && typeof item.reason === "object"
          ? (item.reason as Record<string, string>)
          : undefined,
    });
  }

  return map;
}

/**
 * Trả về map key → kết quả AI. Key nào thất bại sẽ KHÔNG có trong map để nơi
 * gọi tự dùng công thức dự phòng — một mục lỗi không làm hỏng cả lần sinh.
 */
export async function requestPricingBatch(
  items: PricingBatchItem[],
): Promise<Map<string, PricingBatchResult>> {
  const results = new Map<string, PricingBatchResult>();
  if (items.length === 0) return results;

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const chunk = items.slice(start, start + BATCH_SIZE);

    try {
      const content = await requestChatCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: JSON.stringify({
          items: chunk.map((item) => ({
            key: item.key,
            garmentName: item.garmentName,
            basePrice: item.basePrice,
            purchaseCost: item.purchaseCost,
            demandPressure: item.demandPressure,
            bookingPressure: item.bookingPressure,
            holidays: item.holidays,
          })),
        }),
        temperature: 0.2,
        // 1 mục ≈ 120-200 token (kể cả token thinking) → 1024 đủ cho 10 mục,
        // requestChatCompletion vẫn tự tăng nếu bị cắt.
        maxTokens: 1024,
        // Bớt retry để một lần bấm không kéo dài quá lâu khi provider quá tải.
        attempts: 2,
        label: "Pricing AI",
      });

      const parsed = parseItems(content);
      for (const [key, value] of parsed) {
        if (chunk.some((item) => item.key === key)) results.set(key, value);
      }

      const missing = chunk.filter((item) => !results.has(item.key));
      if (missing.length > 0) {
        logger.warn(
          `Thiếu kết quả AI cho ${missing.length}/${chunk.length} size — dùng công thức dự phòng cho các size đó`,
        );
      }
    } catch (error) {
      logger.error(
        `Lô ${start / BATCH_SIZE + 1} thất bại, dùng công thức dự phòng: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return results;
}
