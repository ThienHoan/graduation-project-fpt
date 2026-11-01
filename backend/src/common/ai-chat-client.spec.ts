import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestChatCompletion } from "./ai-chat-client";

const ENV_KEYS = [
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_FALLBACK_MODEL",
  "AI_MAX_TOKENS",
  "AI_TIMEOUT_MS",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_FALLBACK_MODEL",
  "OPENROUTER_MAX_TOKENS",
  "OPENROUTER_TIMEOUT_MS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function okResponse(content: string, finishReason = "stop") {
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
        }),
      ),
  } as Response;
}

function errorResponse(status: number, body = "error") {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as Response;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchMock.mock.calls[index][1] as RequestInit;
  return JSON.parse(String(init.body)) as {
    model: string;
    max_tokens: number;
    response_format?: { type: string };
  };
}

describe("requestChatCompletion", () => {
  beforeEach(() => {
    clearEnv();
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "primary-model";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearEnv();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("returns the model content", async () => {
    global.fetch = vi.fn().mockResolvedValue(okResponse('{"ok":true}')) as unknown as typeof fetch;

    const content = await requestChatCompletion({
      systemPrompt: "system",
      userMessage: "user",
    });

    expect(content).toBe('{"ok":true}');
    expect(requestBody(global.fetch as never, 0).response_format).toEqual({ type: "json_object" });
  });

  it("retries a 503 once on the same model", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, "high demand"))
      .mockResolvedValueOnce(okResponse('{"ok":true}')) as unknown as typeof fetch;

    const content = await requestChatCompletion({
      systemPrompt: "system",
      userMessage: "user",
    });

    expect(content).toBe('{"ok":true}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(global.fetch as never, 1).model).toBe("primary-model");
  });

  it("falls back to the fallback model when the primary keeps failing", async () => {
    process.env.AI_FALLBACK_MODEL = "fallback-model";
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse('{"ok":true}')) as unknown as typeof fetch;

    const content = await requestChatCompletion({
      systemPrompt: "system",
      userMessage: "user",
    });

    expect(content).toBe('{"ok":true}');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(requestBody(global.fetch as never, 2).model).toBe("fallback-model");
  });

  it("retries with a bigger max_tokens when the JSON is truncated", async () => {
    process.env.AI_MAX_TOKENS = "100";
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okResponse('{"topics":[', "length"))
      .mockResolvedValueOnce(okResponse('{"topics":[]}')) as unknown as typeof fetch;

    const content = await requestChatCompletion({
      systemPrompt: "system",
      userMessage: "user",
    });

    expect(content).toBe('{"topics":[]}');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(global.fetch as never, 0).max_tokens).toBe(100);
    expect(requestBody(global.fetch as never, 1).max_tokens).toBe(200);
  });

  it("does not retry non-retryable errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(errorResponse(401, "Unauthorized")) as unknown as typeof fetch;

    await expect(
      requestChatCompletion({ systemPrompt: "system", userMessage: "user" }),
    ).rejects.toThrow("AI API 401");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws when no API key is configured", async () => {
    delete process.env.AI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await expect(
      requestChatCompletion({ systemPrompt: "system", userMessage: "user" }),
    ).rejects.toThrow("OPENROUTER_API_KEY not configured");
  });

  it("reads the legacy OPENROUTER_* variables", async () => {
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    process.env.OPENROUTER_API_KEY = "legacy-key";
    process.env.OPENROUTER_MODEL = "legacy-model";
    global.fetch = vi.fn().mockResolvedValue(okResponse("{}")) as unknown as typeof fetch;

    await requestChatCompletion({ systemPrompt: "system", userMessage: "user" });

    expect(requestBody(global.fetch as never, 0).model).toBe("legacy-model");
  });
});
