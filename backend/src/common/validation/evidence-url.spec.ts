import { afterEach, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertOwnedEvidenceUrl } from "./evidence-url";

const OWNER_ID = "00000000-0000-4000-8000-000000000007";
const BASE = "https://example.supabase.co/storage/v1/object/public/products";

function url(purpose = "handover", owner = OWNER_ID, extension = "jpg") {
  return `${BASE}/${purpose}/${owner}/00000000-0000-4000-8000-000000000008.${extension}`;
}

describe("assertOwnedEvidenceUrl", () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
  });

  it("accepts a purpose-scoped URL owned by the actor", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    expect(assertOwnedEvidenceUrl(url(), { purpose: "handover", ownerId: OWNER_ID })).toBe(url());
  });

  it.each([
    ["wrong origin", "https://other.supabase.co/storage/v1/object/public/products/handover/${OWNER_ID}/00000000-0000-4000-8000-000000000008.jpg"],
    ["wrong purpose", url("refund-proof")],
    ["wrong owner", url("handover", "00000000-0000-4000-8000-000000000009")],
    ["query string", `${url()}?download=1`],
    ["fragment", `${url()}#image`],
    ["unsupported extension", url("handover", OWNER_ID, "gif")],
    ["legacy path", `${BASE}/handover/00000000-0000-4000-8000-000000000008.jpg`],
  ])("rejects %s", (_label, value) => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    expect(() => assertOwnedEvidenceUrl(value, { purpose: "handover", ownerId: OWNER_ID })).toThrow(BadRequestException);
  });
});
