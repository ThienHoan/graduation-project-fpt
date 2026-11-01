/**
 * Cấu hình provider cho các lời gọi "chat completions" kiểu OpenAI.
 *
 * Trước đây URL bị hardcode `https://openrouter.ai/api/v1/chat/completions`
 * nên đổi key/model sang provider khác là không dùng được. Giờ đọc từ env:
 *
 *   AI_BASE_URL  — base URL của provider (mặc định OpenRouter)
 *   AI_API_KEY   — key của provider
 *   AI_MODEL / AI_FALLBACK_MODEL / AI_VISION_MODEL — tên model
 *
 * Vẫn đọc các biến OPENROUTER_* cũ làm fallback để cấu hình hiện tại không vỡ.
 *
 * Gemini có endpoint tương thích OpenAI:
 *   AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *   AI_MODEL=gemini-2.5-flash
 */

export type AiProviderConfig = {
  /** Base URL đã bỏ dấu "/" ở cuối, ví dụ `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  /** URL đầy đủ để gọi chat completions. */
  chatCompletionsUrl: string;
  /** Rỗng khi chưa cấu hình key. */
  apiKey: string;
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** Provider có cần header riêng của OpenRouter không (HTTP-Referer, X-Title). */
export function isOpenRouter(baseUrl: string): boolean {
  return /(^|\.)openrouter\.ai$/i.test(safeHostname(baseUrl));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function readAiProviderConfig(): AiProviderConfig {
  const rawBaseUrl =
    process.env.AI_BASE_URL?.trim() ||
    process.env.OPENROUTER_BASE_URL?.trim() ||
    DEFAULT_BASE_URL;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const apiKey =
    process.env.AI_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    "";

  return { baseUrl, chatCompletionsUrl: `${baseUrl}/chat/completions`, apiKey };
}

const MODEL_ENV_BY_KIND = {
  text: ["AI_MODEL", "OPENROUTER_MODEL"],
  fallback: ["AI_FALLBACK_MODEL", "OPENROUTER_FALLBACK_MODEL"],
} as const;

/**
 * Đọc tên model theo loại, ưu tiên biến AI_* rồi mới tới OPENROUTER_*.
 * Trả `undefined` nếu chưa cấu hình để nơi gọi tự dùng default.
 */
export function readAiModel(kind: keyof typeof MODEL_ENV_BY_KIND): string | undefined {
  for (const name of MODEL_ENV_BY_KIND[kind]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Provider riêng cho giám định ảnh trả hàng.
 *
 * Giám định ảnh luôn chạy trên OpenRouter như trước, KHÔNG đi theo AI_* —
 * để đổi provider cho chat/gợi ý/giá mà không ảnh hưởng luồng đọc ảnh.
 * Chỉ cần `OPENROUTER_API_KEY` + `OPENROUTER_VISION_MODEL` (hoặc `OPENROUTER_MODEL`).
 */
export function readVisionProviderConfig(): AiProviderConfig {
  const rawBaseUrl =
    process.env.VISION_BASE_URL?.trim() ||
    process.env.OPENROUTER_BASE_URL?.trim() ||
    DEFAULT_BASE_URL;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const apiKey =
    process.env.VISION_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    "";

  return { baseUrl, chatCompletionsUrl: `${baseUrl}/chat/completions`, apiKey };
}

/** Model đọc ảnh: OPENROUTER_VISION_MODEL → OPENROUTER_MODEL → default ở nơi gọi. */
export function readVisionModel(): string | undefined {
  return (
    process.env.VISION_MODEL?.trim() ||
    process.env.OPENROUTER_VISION_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    undefined
  );
}

/** Số dương từ env, thử biến mới trước rồi tới biến cũ, cuối cùng là default. */
export function readAiPositiveNumber(
  primaryEnv: string,
  legacyEnv: string,
  fallback: number,
): number {
  for (const name of [primaryEnv, legacyEnv]) {
    const parsed = Number(process.env[name]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}
