import { describe, expect, it } from "vitest";
import { planAutoReply } from "./auto-reply-policy";

const productCard = {
  content: "",
  messageType: "product_card",
  metadata: {
    product: { id: "g-1", name: "Áo dài đỏ thêu sen", size: "M", price: 350000 },
  },
};

const bookingCard = (topic: "booking_support" | "complaint") => ({
  content: "",
  messageType: "booking_card",
  metadata: {
    topic,
    booking: {
      code: "BK123456",
      statusLabel: "Đã xác nhận",
      rentalStartDate: "2026-11-01T00:00:00.000Z",
      rentalEndDate: "2026-11-03T00:00:00.000Z",
    },
  },
});

describe("planAutoReply", () => {
  it("skips empty and emoji-only messages", () => {
    expect(planAutoReply("   ").kind).toBe("skip");
    expect(planAutoReply("🙂🙂").kind).toBe("skip");
    expect(planAutoReply("\u200B\u200B").kind).toBe("skip");
  });

  it("skips short acknowledgements so AI does not answer every 'ok'", () => {
    expect(planAutoReply("ok").kind).toBe("skip");
    expect(planAutoReply("Ok shop!").kind).toBe("skip");
    expect(planAutoReply("dạ vâng ạ").kind).toBe("skip");
  });

  it("still lets greetings and thanks reach the AI layer", () => {
    expect(planAutoReply("chào shop")).toEqual({ kind: "ai", request: "chào shop" });
    expect(planAutoReply("cảm ơn shop nhé").kind).toBe("ai");
  });

  it("sends normal questions to the AI with the original text", () => {
    expect(planAutoReply("áo dài tím còn hàng khônh")).toEqual({
      kind: "ai",
      request: "áo dài tím còn hàng khônh",
    });
  });

  it("hands off order and booking questions without calling the model", () => {
    const plan = planAutoReply("mình muốn hủy đơn hàng hôm nay");

    expect(plan.kind).toBe("canned");
    if (plan.kind !== "canned") return;
    expect(plan.reason).toBe("order_support");
    expect(plan.reply).toContain("mã đơn");
  });

  it("recognises the alternative spelling 'huỷ'", () => {
    expect(planAutoReply("shop ơi huỷ giúp mình lịch hẹn").kind).toBe("canned");
  });

  it("hands off complaints and damaged-item reports", () => {
    const plan = planAutoReply("áo bị rách khi nhận");

    expect(plan.kind).toBe("canned");
    if (plan.kind !== "canned") return;
    expect(plan.reason).toBe("complaint");
    expect(plan.reply).toContain("xin lỗi");
  });

  it("does not treat the name 'Huy' as a cancel request", () => {
    expect(planAutoReply("mình tên Huy, muốn thuê áo dài").kind).toBe("ai");
    expect(planAutoReply("bạn Huy tư vấn giúp mình nhé").kind).toBe("ai");
  });

  it("does not hand off ordinary product questions", () => {
    expect(planAutoReply("áo dài đỏ còn không").kind).toBe("ai");
    expect(planAutoReply("tư vấn giúp mình áo dài size M").kind).toBe("ai");
  });

  it("turns a product card into a concrete product question", () => {
    const plan = planAutoReply(productCard);

    expect(plan.kind).toBe("ai");
    if (plan.kind !== "ai") return;
    expect(plan.request).toContain("Áo dài đỏ thêu sen");
    expect(plan.request).toContain("size M");
    expect(plan.request).toContain("350.000");
    expect(plan.request).toContain("Tư vấn");
  });

  it("handles a product card without metadata", () => {
    const plan = planAutoReply({ content: "", messageType: "product_card" });

    expect(plan.kind).toBe("ai");
    if (plan.kind !== "ai") return;
    expect(plan.request).toContain("sản phẩm");
  });

  it("answers booking support cards with a fixed staff handoff", () => {
    const plan = planAutoReply(bookingCard("booking_support"));

    expect(plan.kind).toBe("canned");
    if (plan.kind !== "canned") return;
    expect(plan.reason).toBe("booking_handoff");
    expect(plan.reply).toContain("BK123456");
    expect(plan.reply).toContain("Đã xác nhận");
    expect(plan.reply).toContain("Nhân viên");
  });

  it("answers complaint cards with an apology and staff handoff", () => {
    const plan = planAutoReply(bookingCard("complaint"));

    expect(plan.kind).toBe("canned");
    if (plan.kind !== "canned") return;
    expect(plan.reason).toBe("complaint_handoff");
    expect(plan.reply).toContain("xin lỗi");
    expect(plan.reply).toContain("BK123456");
  });

  it("acknowledges image uploads and asks for a text description", () => {
    const plan = planAutoReply({ content: "", messageType: "image" });

    expect(plan.kind).toBe("canned");
    if (plan.kind !== "canned") return;
    expect(plan.reason).toBe("media_ack");
    expect(plan.reply).toContain("hình ảnh");
    expect(plan.reply).toContain("mô tả");
  });

  it("routes media in a booking/complaint conversation to staff", () => {
    const plan = planAutoReply({ content: "", messageType: "video" }, "complaint");

    expect(plan.kind).toBe("canned");
    if (plan.kind !== "canned") return;
    expect(plan.reason).toBe("media_handoff");
    expect(plan.reply).toContain("video");
    expect(plan.reply).toContain("Nhân viên");
  });

  it("skips unsupported message types instead of calling the model", () => {
    expect(planAutoReply({ content: "file.pdf", messageType: "file" }).kind).toBe("skip");
  });
});
