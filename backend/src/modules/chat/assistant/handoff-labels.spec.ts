import { describe, expect, it } from "vitest";
import { handoffBadgeForReason } from "./handoff-labels";

describe("handoffBadgeForReason", () => {
  it("maps complaint reasons to the complaint group", () => {
    expect(handoffBadgeForReason("complaint")).toEqual({
      label: "Khiếu nại",
      group: "complaint",
    });
    expect(handoffBadgeForReason("booking_card_complaint").group).toBe("complaint");
    expect(handoffBadgeForReason("sensitive_followup").group).toBe("complaint");
  });

  it("puts money and staff requests in the payment group", () => {
    for (const reason of [
      "refund",
      "payment",
      "bank_account_manual",
      "price_negotiation",
      "staff_request",
    ]) {
      expect(handoffBadgeForReason(reason).group).toBe("payment");
    }
  });

  it("falls back to the bot group for unknown reasons", () => {
    expect(handoffBadgeForReason("something_new")).toEqual({
      label: "Bot chuyển",
      group: "bot",
    });
    expect(handoffBadgeForReason(null)).toEqual({ label: "Bot chuyển", group: "bot" });
  });

  it("never returns a raw key as the visible label", () => {
    for (const reason of [
      "unhandled_message",
      "assistant_error",
      "repeat_guard",
      "faq_config_missing",
      "product_lookup_unresolved",
      "catalog_empty",
      "availability_unverified",
      "order_change",
      "order_lookup_unresolved",
      "order_lookup_denied",
      "order_delivery_support",
      "booking_card_support",
      "urgent_rental",
      "media_received",
      "bulk_order",
    ]) {
      const badge = handoffBadgeForReason(reason);
      expect(badge.group).toBe("bot");
      expect(badge.label).not.toContain("_");
      expect(badge.label).not.toBe(reason);
    }
  });
});