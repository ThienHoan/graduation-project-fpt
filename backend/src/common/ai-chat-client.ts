import { Logger } from "@nestjs/common";
import {
  readAiModel,
  readAiPositiveNumber,
  readAiProviderConfig,
} from "./ai-provider";

/**
 * Gọi chat-completions (kiểu OpenAI) cho các tác vụ text: auto-reply, gợi ý,
 * gợi ý giá.
 *
 * Xử lý những lỗi hay gặp khi chạy model Gemini 3:
 * - 503/429 do quá tải tạm thời → retry rồi chuyển model dự phòng.
 * - JSON bị cắt vì model tính cả token "thinking" vào max_tokens
 *   (`finish_reason=length`) → thử lại với max_tokens lớn hơn.
 */
export type ChatCompletionOptions = {
  systemPrompt: string;
  userMessage: string;
  /** Mặc định đọc AI_MAX_TOKENS / OPENROUTER_MAX_TOKENS, cuối cùng là 2048. */
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Tiền tố log, ví dụ "Pricing AI". */
  label?: string;
  /** Mặc định true — mọi caller hiện tại đều cần JSON. */
  jsonMode?: boolean;
  /** Số lần thử tối đa cho mỗi model (mặc định 3). */
  attempts?: number;
};

const DEFAULT_MAX_TOKENS = 2048;
const MAX_TOKENS_CEILING = 8192;
const MAX_ATTEMPTS = 3;
const logger = new Logger("AiChatClient");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function defaultTimeoutMs(): number {
  return readAiPositiveNumber("AI_TIMEOUT_MS", "OPENROUTER_TIMEOUT_MS", 25_000);
}

export async function requestChatCompletion(
  options: ChatCompletionOptions,
): Promise<string> {
  const provider = readAiProviderConfig();
  if (!provider.apiKey) {
    // Giữ nguyên thông điệp cũ để không phá các chỗ đang dựa vào nó.
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const primaryModel = readAiModel("text") || "openai/gpt-4o-mini";
  const fallbackModel = readAiModel("fallback");
  const models = [
    ...new Set([primaryModel, fallbackModel].filter(Boolean)),
  ] as string[];

  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs();
  const maxAttempts = Math.max(1, options.attempts ?? MAX_ATTEMPTS);
  const initialMaxTokens =
    options.maxTokens ??
    readAiPositiveNumber("AI_MAX_TOKENS", "OPENROUTER_MAX_TOKENS", DEFAULT_MAX_TOKENS);
  const label = options.label ?? "AI";
  const jsonMode = options.jsonMode ?? true;
  const temperature = options.temperature ?? 0.2;

  let lastError: Error | null = null;

  for (const model of models) {
    let maxTokens = initialMaxTokens;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(provider.chatCompletionsUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: options.systemPrompt },
              { role: "user", content: options.userMessage },
            ],
            max_tokens: maxTokens,
            temperature,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: controller.signal,
        });

        const text = await res.text();
        if (!res.ok) {
          const error = new Error(
            `AI API ${res.status}: ${text.substring(0, 200)}`,
          );
          if (isRetryableStatus(res.status) && attempt === 1) {
            lastError = error;
            logger.warn(
              `${label}: HTTP ${res.status} (model=${model}) — thử lại sau 500ms`,
            );
            await sleep(500);
            continue;
          }
          throw error;
        }

        let data: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          throw new Error(`AI trả về JSON không hợp lệ: ${text.substring(0, 200)}`);
        }

        const choice = data.choices?.[0];
        const content = choice?.message?.content;

        if (!content) {
          if (choice?.finish_reason === "length" && attempt < maxAttempts) {
            maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_CEILING);
            logger.warn(
              `${label}: phản hồi rỗng do hết token (model=${model}) — thử lại với max_tokens=${maxTokens}`,
            );
            continue;
          }
          throw new Error("AI returned empty response");
        }

        if (choice?.finish_reason === "length") {
          // JSON bị cắt giữa chừng (Gemini 3 tính cả token thinking).
          if (attempt < maxAttempts && maxTokens < MAX_TOKENS_CEILING) {
            maxTokens = Math.min(maxTokens * 2, MAX_TOKENS_CEILING);
            logger.warn(
              `${label}: phản hồi bị cắt (model=${model}) — thử lại với max_tokens=${maxTokens}`,
            );
            continue;
          }
          logger.warn(`${label}: phản hồi bị cắt (finish_reason=length, model=${model})`);
        }

        return content;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isAbort = err.name === "AbortError";
        const isNetworkError =
          err instanceof TypeError || /fetch failed|network|timeout|aborted/i.test(err.message);
        lastError = isAbort ? new Error(`AI timeout after ${timeoutMs}ms`) : err;

        logger.warn(
          `${label} thất bại (model=${model}, attempt=${attempt}): ${lastError.message}`,
        );

        if ((isAbort || isNetworkError) && attempt === 1) {
          await sleep(500);
          continue;
        }
        // Lỗi không retry được (401/400...) hoặc đã hết lượt → sang model dự phòng.
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  throw lastError ?? new Error("AI call failed");
}
