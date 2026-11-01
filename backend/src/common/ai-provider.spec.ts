import { afterEach, describe, expect, it } from "vitest";
import {
  isOpenRouter,
  readAiModel,
  readAiPositiveNumber,
  readAiProviderConfig,
  readVisionModel,
  readVisionProviderConfig,
} from "./ai-provider";

const ENV_KEYS = [
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_FALLBACK_MODEL",
  "AI_TIMEOUT_MS",
  "AI_MAX_TOKENS",
  "VISION_BASE_URL",
  "VISION_API_KEY",
  "VISION_MODEL",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_FALLBACK_MODEL",
  "OPENROUTER_VISION_MODEL",
  "OPENROUTER_TIMEOUT_MS",
  "OPENROUTER_MAX_TOKENS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearAiEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearAiEnv();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value !== undefined) process.env[key] = value;
  }
});

describe("ai provider config", () => {
  it("defaults to OpenRouter when nothing is configured", () => {
    clearAiEnv();
    const config = readAiProviderConfig();
    expect(config.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.chatCompletionsUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(config.apiKey).toBe("");
  });

  it("points to Gemini's OpenAI-compatible endpoint", () => {
    clearAiEnv();
    process.env.AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    process.env.AI_API_KEY = "AQ.zzzz";

    const config = readAiProviderConfig();
    expect(config.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(config.chatCompletionsUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(config.apiKey).toBe("AQ.zzzz");
  });

  it("still reads the legacy OPENROUTER_* variables", () => {
    clearAiEnv();
    process.env.OPENROUTER_API_KEY = "sk-or-legacy";
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";

    const config = readAiProviderConfig();
    expect(config.apiKey).toBe("sk-or-legacy");
    expect(readAiModel("text")).toBe("openai/gpt-4o");
  });

  it("prefers AI_* over OPENROUTER_*", () => {
    clearAiEnv();
    process.env.OPENROUTER_API_KEY = "sk-or-legacy";
    process.env.AI_API_KEY = "AQ.new";
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";
    process.env.AI_MODEL = "gemini-2.5-flash";

    expect(readAiProviderConfig().apiKey).toBe("AQ.new");
    expect(readAiModel("text")).toBe("gemini-2.5-flash");
  });

  it("keeps image inspection on OpenRouter even when text AI points to Gemini", () => {
    clearAiEnv();
    process.env.AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    process.env.AI_API_KEY = "AQ.gemini";
    process.env.AI_MODEL = "gemini-2.5-flash";
    process.env.OPENROUTER_API_KEY = "sk-or-vision";
    process.env.OPENROUTER_VISION_MODEL = "nvidia/nemotron-3.5-super-vl:free";

    const vision = readVisionProviderConfig();
    expect(vision.chatCompletionsUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(vision.apiKey).toBe("sk-or-vision");
    expect(readVisionModel()).toBe("nvidia/nemotron-3.5-super-vl:free");

    // Provider text vẫn là Gemini.
    expect(readAiProviderConfig().apiKey).toBe("AQ.gemini");
  });

  it("falls back to OPENROUTER_MODEL when no vision model is set", () => {
    clearAiEnv();
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";
    expect(readVisionModel()).toBe("openai/gpt-4o");
  });

  it("allows overriding the vision provider explicitly", () => {
    clearAiEnv();
    process.env.VISION_BASE_URL = "https://vision.example.com/v1";
    process.env.VISION_API_KEY = "vision-key";
    process.env.VISION_MODEL = "vision-model";

    const vision = readVisionProviderConfig();
    expect(vision.chatCompletionsUrl).toBe("https://vision.example.com/v1/chat/completions");
    expect(vision.apiKey).toBe("vision-key");
    expect(readVisionModel()).toBe("vision-model");
  });

  it("returns undefined when no vision model is configured", () => {
    clearAiEnv();
    process.env.AI_MODEL = "gemini-2.5-flash";
    expect(readVisionModel()).toBeUndefined();
  });

  it("returns undefined for an unset optional model", () => {
    clearAiEnv();
    expect(readAiModel("fallback")).toBeUndefined();
  });

  it("reads numbers from the new env name before the legacy one", () => {
    clearAiEnv();
    process.env.OPENROUTER_MAX_TOKENS = "512";
    process.env.AI_MAX_TOKENS = "2048";
    expect(readAiPositiveNumber("AI_MAX_TOKENS", "OPENROUTER_MAX_TOKENS", 1024)).toBe(2048);

    delete process.env.AI_MAX_TOKENS;
    expect(readAiPositiveNumber("AI_MAX_TOKENS", "OPENROUTER_MAX_TOKENS", 1024)).toBe(512);

    delete process.env.OPENROUTER_MAX_TOKENS;
    expect(readAiPositiveNumber("AI_MAX_TOKENS", "OPENROUTER_MAX_TOKENS", 1024)).toBe(1024);
  });

  it("detects the OpenRouter host only", () => {
    expect(isOpenRouter("https://openrouter.ai/api/v1")).toBe(true);
    expect(isOpenRouter("https://generativelanguage.googleapis.com/v1beta/openai")).toBe(false);
    expect(isOpenRouter("not-a-url")).toBe(false);
  });
});
