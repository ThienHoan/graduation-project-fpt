import { describe, expect, it } from "vitest";
import { buildAdvisorHistory, type ChatMessage } from "./chat";

const CUSTOMER = "customer-1";
const STAFF = "staff-1";
const OTHER_STAFF = "staff-2";

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "sender_id">): ChatMessage {
  return {
    conversation_id: "conv-1",
    content: "",
    created_at: new Date().toISOString(),
    sender_type: "user",
    message_type: "text",
    metadata: null,
    ...overrides,
  };
}

describe("buildAdvisorHistory", () => {
  it("keeps AI messages in the ai role instead of treating them as customer", () => {
    const history = buildAdvisorHistory({
      messages: [
        message({ id: "m1", sender_id: CUSTOMER, content: "còn áo đỏ không" }),
        message({ id: "m2", sender_id: "ai", sender_type: "ai", content: "Dạ còn ạ" }),
      ],
      customerId: CUSTOMER,
    });

    expect(history.map((h) => h.role)).toEqual(["customer", "ai"]);
  });

  it("marks every non-customer sender as staff, including a previous staff member", () => {
    const history = buildAdvisorHistory({
      messages: [
        message({ id: "m1", sender_id: CUSTOMER, content: "câu hỏi" }),
        message({ id: "m2", sender_id: OTHER_STAFF, content: "staff khác trả lời" }),
        message({ id: "m3", sender_id: STAFF, content: "mình trả lời" }),
      ],
      customerId: CUSTOMER,
    });

    expect(history.map((h) => h.role)).toEqual(["customer", "staff", "staff"]);
  });

  it("excludes the message being answered and deleted messages", () => {
    const history = buildAdvisorHistory({
      messages: [
        message({ id: "old", sender_id: CUSTOMER, content: "tin cũ" }),
        message({ id: "current", sender_id: CUSTOMER, content: "tin đang trả lời" }),
        message({ id: "deleted", sender_id: CUSTOMER, content: "đã xoá", deleted_at: new Date().toISOString() }),
      ],
      customerId: CUSTOMER,
      excludeMessageId: "current",
    });

    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("tin cũ");
  });

  it("describes product, booking and media messages for the model", () => {
    const history = buildAdvisorHistory({
      messages: [
        message({
          id: "p1",
          sender_id: CUSTOMER,
          message_type: "product_card",
          metadata: { product: { name: "Áo dài đỏ", size: "M", price: 350000 } },
        }),
        message({
          id: "b1",
          sender_id: CUSTOMER,
          message_type: "booking_card",
          metadata: { topic: "complaint", booking: { code: "BK123456", statusLabel: "Hoàn thành" } },
        }),
        message({ id: "i1", sender_id: CUSTOMER, message_type: "image" }),
        message({ id: "v1", sender_id: CUSTOMER, message_type: "video" }),
      ],
      customerId: CUSTOMER,
    });

    expect(history[0].content).toContain("Áo dài đỏ");
    expect(history[0].content).toContain("Size: M");
    expect(history[1].content).toContain("BK123456");
    expect(history[1].content).toContain("Hoàn thành");
    expect(history[2].content).toBe("[Hình ảnh]");
    expect(history[3].content).toBe("[Video]");
  });

  it("keeps only the most recent messages up to the limit", () => {
    const messages = Array.from({ length: 15 }, (_, i) =>
      message({ id: `m${i}`, sender_id: CUSTOMER, content: `tin ${i}` }),
    );

    const history = buildAdvisorHistory({
      messages,
      customerId: CUSTOMER,
      limit: 10,
    });

    expect(history).toHaveLength(10);
    expect(history[0].content).toBe("tin 5");
  });
});
