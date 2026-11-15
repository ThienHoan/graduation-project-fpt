import { describe, expect, it } from "vitest";
import { isSafeLink } from "./safe-link";

describe("isSafeLink", () => {
  it.each([
    "/booking/incidents/book-12345678",
    "/dashboard/manager/incidents",
    "/dashboard/customer",
  ])("accepts internal path %s", (value) => {
    expect(isSafeLink(value)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["absolute https", "https://evil.example/phish"],
    ["absolute http", "http://evil.example/phish"],
    ["protocol-relative", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["leading whitespace", " /booking/incidents/1"],
    ["trailing whitespace", "/booking/incidents/1 "],
    ["control character", "/booking/\u0000incidents"],
    ["newline injection", "/booking/incidents\nhttp://evil"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative without slash", "booking/incidents/1"],
    ["empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isSafeLink(value as string | null | undefined)).toBe(false);
  });
});