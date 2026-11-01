import { describe, expect, it } from "vitest";
import type { ClassifierContext, ClassifierResult } from "./classification.types";
import { classifyMessage } from "./message-classifier";
import { normalizeForMatch } from "./text-utils";

const PRODUCT_CARD = {
  id: "g-1",
  name: "Áo dài đỏ thêu sen",
  size: "M",
  price: 350000,
};

function withCard(extra: Partial<ClassifierContext> = {}): ClassifierContext {
  return { lastProductCard: PRODUCT_CARD, ...extra };
}

function classify(text: string, context: ClassifierContext = {}): ClassifierResult {
  return classifyMessage({ content: text }, context);
}

function expectRoute(text: string, route: ClassifierResult["route"], context?: ClassifierContext) {
  const result = classify(text, context);
  expect(result.route, `${text} -> ${result.route} (${result.reason})`).toBe(route);
  return result;
}

describe("message classifier - SKIP", () => {
  it("skips empty, whitespace and emoji-only messages", () => {
    expectRoute("", "SKIP");
    expectRoute("   ", "SKIP");
    expectRoute("\u200B\u200B", "SKIP");
    expectRoute("🙂🙂", "SKIP");
  });

  it("skips pure acknowledgements and 'ok + thanks'", () => {
    for (const text of [
      "ok",
      "Ok shop!",
      "dạ vâng ạ",
      "Ok, cảm ơn shop",
      "hiểu rồi ạ",
    ]) {
      const result = expectRoute(text, "SKIP");
      expect(result.reason).toBe("acknowledgement");
    }
  });

  it("does not skip an acknowledgement that carries a new question", () => {
    const result = expectRoute("ok, mà giá bao nhiêu", "DB");
    expect(result.intent).toBe("db.product_price");
  });

  it("asks again once instead of answering 'dạ' with no derivable slot", () => {
    const result = expectRoute("dạ", "TEMPLATE", {
      previousAssistantMessage: { content: "Bạn muốn size nào ạ?", senderType: "ai" },
    });
    expect(result.templateKey).toBe("contextual_reask");
    expect(result.reason).toBe("contextual_answer_missing_slots");
    expect(result.sensitive).toBe(false);
    expect(result.handoffReason).toBeUndefined();
  });

  it("treats the same 'dạ' as SKIP when no question is open", () => {
    expectRoute("dạ", "SKIP", {
      previousAssistantMessage: { content: "Shop đã ghi nhận thông tin ạ.", senderType: "staff" },
    });
  });

  it("treats a short size answer as context instead of SKIP", () => {
    const result = expectRoute("L", "DB", withCard({
      previousAssistantMessage: { content: "Shop còn size L không?", senderType: "staff" },
    }));
    expect(result.intent).toBe("db.contextual_answer");
    expect(result.slots.size).toBe("L");
  });

  it("treats a short color answer as context instead of SKIP", () => {
    const result = expectRoute("đen", "DB", withCard({
      previousAssistantMessage: { content: "Bạn muốn màu gì?", senderType: "ai" },
    }));
    expect(result.intent).toBe("db.contextual_answer");
    expect(result.slots.color).toBe("den");
  });

  it("still skips 'ok' when the previous assistant message is not a question", () => {
    expectRoute("ok", "SKIP", {
      previousAssistantMessage: { content: "Shop đã ghi nhận thông tin ạ.", senderType: "staff" },
    });
  });
});

describe("message classifier - TEMPLATE", () => {
  it("answers standalone greetings without calling the LLM", () => {
    for (const text of ["chào shop", "shop ơi", "hello", "alo shop", "hi ad"]) {
      const result = expectRoute(text, "TEMPLATE");
      expect(result.templateKey).toBe("greeting");
      expect(result.reason).toBe("greeting_template");
    }
  });

  it("answers standalone thanks without calling the LLM", () => {
    for (const text of ["cảm ơn shop nhé", "thanks shop", "cảm ơn", "cảm ơn shop nhiều"]) {
      const result = expectRoute(text, "TEMPLATE");
      expect(result.templateKey).toBe("thanks");
      expect(result.reason).toBe("thanks_template");
    }
  });

  it("still answers longer thanks without the LLM", () => {
    // Trước đây "cảm ơn shop đã tư vấn" rơi vào nhánh AI vì khớp chữ "tư vấn"
    // và gọi model cho một câu cảm ơn.
    for (const text of [
      "cảm ơn shop đã tư vấn",
      "cảm ơn shop đã tư vấn nhiệt tình",
      "cảm ơn shop nhìu",
      "cảm ơn shop nhen",
      "cảm ơn shop ❤️",
      "shop ơi cảm ơn",
      "cảm ơn shop đã hỗ trợ mình",
      "cảm ơn shop nhé hẹn gặp lại",
    ]) {
      const result = expectRoute(text, "TEMPLATE");
      expect(result.templateKey, text).toBe("thanks");
      expect(result.reason, text).toBe("thanks_template");
    }
  });

  it("keeps a thanks message that also asks for advice on the AI path", () => {
    const result = expectRoute("cảm ơn shop tư vấn giúp mình đồ đi tiệc", "AI");
    expect(result.intent).toBe("ai.styling");
  });

  it("keeps a thanks message with a real question on its own route", () => {
    expectRoute("cảm ơn shop, cho mình hỏi giờ mở cửa", "FAQ");
    expectRoute("cảm ơn shop, nhưng đơn mình bị rách", "STAFF");
  });

  it("sends a greeting plus advice question to AI", () => {
    const result = expectRoute("chào shop, tư vấn giúp mình đồ đi tiệc", "AI");
    expect(result.intent).toBe("ai.styling");
  });

  it("still answers a greeting plus FAQ question from FAQ", () => {
    const result = expectRoute("shop ơi giờ mở cửa mấy giờ", "FAQ");
    expect(result.faqKey).toBe("opening_hours");
  });
});

describe("message classifier - negation and mixed intents", () => {
  it("routes 'không hủy đơn, chỉ hỏi mức cọc' to FAQ", () => {
    const result = expectRoute("không hủy đơn, chỉ hỏi mức cọc", "FAQ");
    expect(result.faqKey).toBe("deposit_policy");
  });

  it("routes the same sentence with teencode and no diacritics to FAQ", () => {
    const result = expectRoute("shop oi k huy don, chi hoi muc coc", "FAQ");
    expect(result.faqKey).toBe("deposit_policy");
  });

  it("does not treat 'không cần gấp' as an urgent request", () => {
    expect(classify("không cần gấp").route).not.toBe("STAFF");
  });

  it("lets STAFF win when FAQ and a cancellation request are mixed", () => {
    const result = expectRoute("địa chỉ shop ở đâu, mà mình muốn hủy đơn", "STAFF");
    expect(result.handoffReason).toBe("order_change");
  });
});

describe("message classifier - STAFF", () => {
  it("hands off complaints and damaged items", () => {
    const result = expectRoute("áo bị rách khi nhận", "STAFF");
    expect(result.reason).toBe("complaint");
    expect(result.sensitive).toBe(true);
  });

  it("recognises cancellation actions including 'huỷ'", () => {
    expectRoute("shop ơi huỷ giúp mình lịch hẹn", "STAFF");
    expectRoute("mình muốn hủy đơn hàng hôm nay", "STAFF");
  });

  it("prioritises STAFF for 'hủy đơn và hoàn cọc thế nào'", () => {
    const result = expectRoute("Hủy đơn và hoàn cọc thế nào?", "STAFF");
    expect(result.handoffReason).toBe("refund");
    expect(result.sensitive).toBe(true);
  });

  it("hands off bank-transfer confirmations", () => {
    const result = expectRoute("Tôi đã chuyển khoản, xác nhận giúp", "STAFF");
    expect(result.reason).toBe("payment");
    expect(result.sensitive).toBe(true);
  });

  it("hands off a bulk order with a discount request", () => {
    const result = expectRoute("Tôi muốn thuê 8 bộ và xin giảm giá", "STAFF");
    expect(result.handoffReason).toBe("price_negotiation");
  });

  it("hands off 5+ outfits even without a discount request", () => {
    const result = expectRoute("đặt 5 bộ", "STAFF");
    expect(result.reason).toBe("bulk_order");
  });

  it("keeps the bulk threshold at 5 outfits", () => {
    expect(classify("4 bộ").reason).not.toBe("bulk_order");
    expect(classify("5 bộ").reason).toBe("bulk_order");
    expect(classify("10 bộ").reason).toBe("bulk_order");
    expect(classify("cả lớp").reason).toBe("bulk_order");
    expect(classify("đoàn phim").reason).toBe("bulk_order");
    expect(classify("5 áo").reason).toBe("bulk_order");
    expect(classify("5 người").reason).not.toBe("bulk_order");
    expect(classify("size 5").reason).not.toBe("bulk_order");
  });

  it("separates FAQ policy questions from staff-only deposit actions", () => {
    expect(expectRoute("cọc bao nhiêu", "FAQ").faqKey).toBe("deposit_policy");

    const hold = expectRoute("đặt cọc giữ bộ này", "STAFF");
    expect(hold.reason).toBe("payment");

    expect(expectRoute("hoàn cọc", "STAFF").reason).toBe("refund");
    expect(expectRoute("có giảm giá không", "FAQ").faqKey).toBe("promotions");
    expect(expectRoute("bớt chút được không", "STAFF").reason).toBe("price_negotiation");
  });

  it("counts a group booking in people", () => {
    expectRoute("đặt cho 5 người", "STAFF");
  });

  it("hands off urgent same-day rentals", () => {
    const result = expectRoute("mình cần thuê gấp trong ngày", "STAFF");
    expect(result.handoffReason).toBe("urgent_rental");
  });

  it("hands off tailoring and special requests", () => {
    expectRoute("sửa size giúp mình", "STAFF");
    expectRoute("mình muốn may đo", "STAFF");
  });

  it("hands off requests to speak to staff", () => {
    const result = expectRoute("cho mình gặp nhân viên", "STAFF");
    expect(result.handoffReason).toBe("staff_request");
  });

  it("hands off typed order codes because there is no public code column", () => {
    const result = expectRoute("mã đơn BK123456 của mình sao rồi", "STAFF");
    expect(result.reason).toBe("order_code_unsupported");
    expect(result.slots.orderCode).toBe("BK-123456");
  });

  it("returns STAFF with product_code_unsupported for a product code", () => {
    const result = expectRoute("Mẫu NB-012 giá bao nhiêu?", "STAFF");
    expect(result.reason).toBe("product_code_unsupported");
    expect(result.slots.productCode).toBe("NB-012");
    expect(result.sensitive).toBe(false);
  });

  it("routes day-specific availability to the database instead of guessing stock", () => {
    const result = expectRoute("ngày mai còn áo dài đỏ không", "DB");
    expect(result.reason).toBe("db_product_availability");
    expect(result.intent).toBe("db.product_availability");
    expect(result.matchedRule).toBe("db.product_availability");
    expect(result.slots.dateMentioned).toBe(true);
  });

  it("hands off images and videos", () => {
    const image = classifyMessage({ content: "", messageType: "image" });
    expect(image.route).toBe("STAFF");
    expect(image.reason).toBe("media_received");

    const damagedPhoto = classifyMessage({ content: "đồ bị rách", messageType: "image" });
    expect(damagedPhoto.route).toBe("STAFF");
    expect(damagedPhoto.reason).toBe("complaint");
  });

  it("hands off media requests typed as text", () => {
    expect(expectRoute("ảnh đồ hư", "STAFF").reason).toBe("complaint");

    const similar = expectRoute("ảnh tìm mẫu tương tự", "STAFF");
    expect(similar.reason).toBe("media_request");
    expect(similar.sensitive).toBe(false);
  });

  it("hands off booking cards with the right reason", () => {
    const complaint = classifyMessage({
      content: "",
      messageType: "booking_card",
      metadata: { topic: "complaint", booking: { id: "b-1" } },
    });
    expect(complaint.route).toBe("STAFF");
    expect(complaint.reason).toBe("booking_card_complaint");
    expect(complaint.sensitive).toBe(true);
  });
});

describe("message classifier - FAQ", () => {
  it.each([
    ["Mức cọc thuê đồ là bao nhiêu?", "deposit_policy"],
    ["shop ơi giờ mở cửa mấy giờ", "opening_hours"],
    ["địa chỉ shop ở đâu", "address"],
    ["cho mình xin số điện thoại shop", "phone"],
    ["số tài khoản ngân hàng của shop", "bank_account"],
    ["shop có ship không", "shipping"],
    ["có cần hẹn thử đồ không", "try_on_appointment"],
    ["có phải tự giặt không", "laundry"],
    ["cần mang giấy tờ gì", "documents"],
    ["thuê 3 bộ được giảm giá bao nhiêu", "promotions"],
  ])("routes '%s' to FAQ %s", (text, key) => {
    const result = expectRoute(text, "FAQ");
    expect(result.faqKey).toBe(key);
    expect(result.sensitive).toBe(false);
  });

  it("returns every FAQ topic present in a combined question", () => {
    const result = expectRoute("em có thể thuê bao lâu và giá ship như nào", "FAQ");
    expect(result.faqKeys).toEqual(["rental_duration", "shipping"]);
    expect(result.faqKey).toBe("rental_duration");
  });

  it("matches FAQ without diacritics", () => {
    const result = expectRoute("muc coc thue do la bao nhieu", "FAQ");
    expect(result.faqKey).toBe("deposit_policy");
  });

  it("does not let FAQ hijack outfit pairing advice", () => {
    const result = expectRoute("phối đồ này với phụ kiện nào", "AI", withCard());
    expect(result.intent).toBe("ai.styling");
  });
});

describe("message classifier - DB", () => {
  it("looks up the price of the latest product card", () => {
    const result = expectRoute("bộ này giá bao nhiêu", "DB", withCard());
    expect(result.intent).toBe("db.product_price");
    expect(result.slots.productReference).toBe("last_card");
    expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
    expect(result.missingParams).toEqual([]);
  });

  it("asks for the product when a size question has no product context", () => {
    const result = expectRoute("Còn size L không?", "DB");
    expect(result.intent).toBe("db.catalog_search");
    expect(result.missingParams).toEqual(["product"]);
  });

  it("queries by name and colour when both are present", () => {
    const result = expectRoute("áo dài đỏ còn không", "DB");
    expect(result.intent).toBe("db.catalog_search");
    expect(result.slots.color).toBe("do");
    expect(result.missingParams).toEqual([]);
  });

  it("answers 'có áo dài size M không' from the database", () => {
    const result = expectRoute("có áo dài size M không", "DB");
    expect(result.intent).toBe("db.catalog_search");
    expect(result.slots.size).toBe("M");
  });

  it("keeps advice requests in the AI branch even when a size is mentioned", () => {
    const result = expectRoute("tư vấn giúp mình áo dài size M", "AI");
    expect(result.intent).toBe("ai.styling");
  });

  it("routes a product-info request with a named product to the info handler", () => {
    const result = expectRoute("Tư vấn tôi sản phẩm áo dài đỏ thêu sen size L", "DB");
    expect(result.intent).toBe("db.product_info");
    expect(result.slots.color).toBe("do");
    expect(result.slots.size).toBe("L");
    expect(result.slots.productReference).toBe("named");
  });

  it("routes 'cho tôi thông tin ... sản phẩm X' to the info handler", () => {
    const result = expectRoute(
      "Cho tôi thông tin liên quan đến sản phẩm áo dài đỏ thêu sen size L",
      "DB",
    );
    expect(result.intent).toBe("db.product_info");
  });

  it("still sends pure styling advice to AI (no product-info signal)", () => {
    expect(expectRoute("tư vấn cho mình bộ đi tiệc", "AI").intent).toBe("ai.styling");
  });

  it("routes 'còn trống ngày mai' to the database without treating it as urgent", () => {
    const result = expectRoute("còn trống ngày mai không", "DB", withCard());
    expect(result.intent).toBe("db.product_availability");
  });

  it("routes accessory questions about the shown product to the database", () => {
    const result = expectRoute("mẫu này có phụ kiện đi kèm không", "DB", withCard());
    expect(result.intent).toBe("db.product_accessories");
    expect(result.slots.productReference).toBe("last_card");
    expect(result.missingParams).toEqual([]);
  });

  it("routes 'mẫu khác' to same-category alternatives", () => {
    const result = expectRoute("còn mẫu khác không", "DB", withCard());
    expect(result.intent).toBe("db.product_alternatives");
    expect(result.slots.productReference).toBe("last_card");
  });

  it("lists categories when the customer asks what the shop sells", () => {
    const result = expectRoute("shop có những sản phẩm gì", "DB");
    expect(result.intent).toBe("db.product_categories");
    expect(result.missingParams).toEqual([]);
  });

  it("treats a short answer after the category list as a category choice", () => {
    const result = expectRoute("áo dài", "DB", {
      previousAssistantMessage: {
        content:
          "Dạ shop hiện có các danh mục: Áo dài, Vest, Phụ kiện. Anh/chị muốn xem loại nào ạ?",
        senderType: "ai",
      },
    });
    expect(result.intent).toBe("db.category_products");
  });

  it("lists categories for other ways of asking what the shop sells", () => {
    expect(expectRoute("shop bán gì", "DB").intent).toBe("db.product_categories");
    expect(expectRoute("shop có đồ gì", "DB").intent).toBe("db.product_categories");
    expect(expectRoute("shop có bán gì", "DB").intent).toBe("db.product_categories");
    expect(expectRoute("shop có bán những gì", "DB").intent).toBe(
      "db.product_categories",
    );
  });

  it("lists categories when the customer asks for the category list", () => {
    for (const text of [
      "cho tôi danh mục",
      "cho mình xem danh mục",
      "xem danh mục sản phẩm",
    ]) {
      const result = expectRoute(text, "DB");
      expect(result.intent, text).toBe("db.product_categories");
      expect(result.missingParams).toEqual([]);
    }
  });

  it("reads 'trang phuc xam' as grey, not white", () => {
    const result = expectRoute("có trang phục xám k", "DB");
    expect(result.intent).toBe("db.catalog_search");
    expect(result.slots.color).toBe("xam");
    expect(result.slots.productReference).toBe("named");
    expect(result.missingParams).toEqual([]);
  });

  it("reads a trailing colour after a 'trang phuc' noun", () => {
    const result = expectRoute("shop có trang phục màu đỏ không", "DB");
    expect(result.slots.color).toBe("do");
  });

  it("treats 'có' after a category offer as a request for the category list", () => {
    const result = expectRoute("có", "DB", {
      previousAssistantMessage: {
        content:
          "Dạ shop hiện chưa có mẫu màu xám. Anh/chị muốn em gợi ý mẫu khác hoặc xem danh mục sản phẩm không ạ?",
        senderType: "ai",
      },
    });
    expect(result.intent).toBe("db.product_categories");
    expect(result.reason).toBe("affirmative_categories");
  });

  it("treats 'có' after an alternatives offer as a request for other samples", () => {
    const result = expectRoute("có", "DB", withCard({
      previousAssistantMessage: {
        content: "Anh/chị muốn em gợi ý mẫu khác không ạ?",
        senderType: "ai",
      },
    }));
    expect(result.intent).toBe("db.product_alternatives");
    expect(result.reason).toBe("affirmative_alternatives");
    expect(result.slots.productReference).toBe("last_card");
  });

  it("does not borrow the last product card for a category question", () => {
    const result = expectRoute("shop có bán gì", "DB", withCard());
    expect(result.intent).toBe("db.product_categories");
    expect(result.slots.productReference).toBeUndefined();
    expect(result.slots.lastProductCardId).toBeUndefined();
  });

  it("treats 'ko', 'không' and 'thôi' as a decline instead of an unknown handoff", () => {
    for (const text of ["ko", "không", "thôi", "không cần đâu", "thôi shop"]) {
      const result = expectRoute(text, "TEMPLATE", withCard());
      expect(result.reason, text).toBe("decline_template");
    }
  });

  it("keeps the open product card for 'sản phẩm còn hàng ngày mai không'", () => {
    const result = expectRoute("sản phẩm còn hàng ngày mai k", "DB", withCard());
    expect(result.intent).toBe("db.product_availability");
    expect(result.slots.productReference).toBe("last_card");
    expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
    expect(result.missingParams).toEqual([]);
  });

  it("keeps the open product card for 'áo dài này còn hàng ngày mai không'", () => {
    for (const text of [
      "ngày mai còn áo dài này k",
      "áo dài này còn hàng cho ngày mai k",
      "bộ vest này còn trống ngày mai không",
    ]) {
      const result = expectRoute(text, "DB", withCard());
      expect(result.intent, text).toBe("db.product_availability");
      expect(result.slots.productReference, text).toBe("last_card");
      expect(result.slots.lastProductCardId, text).toBe(PRODUCT_CARD.id);
      expect(result.missingParams, text).toEqual([]);
    }
  });

  it("checks today's stock for 'áo dài này còn hàng không'", () => {
    const result = expectRoute("áo dài này còn hàng không", "DB", withCard());
    expect(result.intent).toBe("db.product_stock");
    expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
  });

  it("does not treat time phrases like 'hôm nay' as a product reference", () => {
    const result = expectRoute("hôm nay còn áo dài không", "DB", withCard());
    expect(result.slots.productReference).not.toBe("last_card");
    expect(result.slots.lastProductCardId).toBeUndefined();
  });

  it("answers 'còn size nào khác không' with the sizes of the open sample", () => {
    for (const text of ["có size nào khác k", "sản phẩm còn size khác k"]) {
      const result = expectRoute(text, "DB", withCard());
      expect(result.intent, text).toBe("db.product_sizes");
      expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
      expect(result.missingParams).toEqual([]);
    }
  });

  it("checks today's stock for 'hiện còn hàng không' instead of describing the sample", () => {
    const result = expectRoute("hiện còn hàng k", "DB", withCard());
    expect(result.intent).toBe("db.product_stock");
    expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
  });

  it("keeps asking price for the open sample with its id attached", () => {
    const result = expectRoute("tôi muốn kiểm tra giá thuê", "DB", withCard());
    expect(result.intent).toBe("db.product_price");
    expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
  });

  it("still searches the whole catalog for a requested colour even with a product card open", () => {
    const result = expectRoute("shop có sản phẩm màu hồng không", "DB", withCard());
    expect(result.intent).toBe("db.catalog_search");
    expect(result.slots.color).toBe("hong");
    expect(result.slots.productReference).toBe("named");
    expect(result.slots.lastProductCardId).toBeUndefined();
    expect(result.missingParams).toEqual([]);
  });

  it("searches the whole catalog for size and occasion instead of reusing the card", () => {
    const result = expectRoute(
      "có sản phẩm size L và hợp cho dự tiệc không",
      "DB",
      withCard(),
    );
    // Có nêu dịp cụ thể ⇒ lọc theo dịp trên toàn catalog (kèm size), không dùng
    // lại card đang xem.
    expect(result.intent).toBe("db.catalog_occasion");
    expect(result.slots.size).toBe("L");
    expect(result.slots.productReference).toBe("named");
    expect(result.slots.lastProductCardId).toBeUndefined();
    expect(result.missingParams).toEqual([]);
  });

  it("searches the catalog for 'shop có bán X không'", () => {
    const result = expectRoute("shop có bán áo dài không", "DB");
    expect(result.intent).toBe("db.catalog_search");
  });

  it("looks up order status only with the conversation bookingId", () => {
    const withBooking = expectRoute("trạng thái đơn của tôi", "DB", { bookingId: "b-1" });
    expect(withBooking.intent).toBe("db.order_status");
    expect(withBooking.missingParams).toEqual([]);

    const withoutBooking = expectRoute("trạng thái đơn của tôi", "DB");
    expect(withoutBooking.missingParams).toEqual(["bookingId"]);
  });

  it("treats a product card itself as a product detail lookup", () => {
    const result = classifyMessage({
      content: "",
      messageType: "product_card",
      metadata: { product: PRODUCT_CARD },
    });
    expect(result.route).toBe("DB");
    expect(result.intent).toBe("db.product_card_detail");
    expect(result.slots.lastProductCardId).toBe(PRODUCT_CARD.id);
  });
});

describe("message classifier - AI", () => {
  it("uses AI for occasion styling", () => {
    const result = expectRoute("Chụp kỷ yếu nên mặc bộ nào?", "AI");
    expect(result.intent).toBe("ai.styling");
    expect(result.aiRequest).toBe("Chụp kỷ yếu nên mặc bộ nào?");
  });

  it("uses AI for outfit and accessory pairing", () => {
    const result = expectRoute("phối đồ này với phụ kiện nào", "AI", withCard());
    expect(result.intent).toBe("ai.styling");
  });

  it("uses AI for comparisons", () => {
    expect(expectRoute("so sánh mẫu A và B", "AI").intent).toBe("ai.comparison");
  });

  it("uses AI for sizing judgement from measurements", () => {
    const result = expectRoute("cao 1m65 nặng 50kg nên mặc size gì", "AI");
    expect(result.intent).toBe("ai.sizing");
  });

  it("uses AI for heritage explanations", () => {
    expect(expectRoute("áo dài có nguồn gốc thế nào", "AI").intent).toBe("ai.heritage");
  });

  it("uses AI when a greeting is followed by an advice question", () => {
    const result = expectRoute("chào shop, tư vấn giúp mình đồ đi tiệc", "AI");
    expect(result.intent).toBe("ai.styling");
  });
});

describe("message classifier - handoff context", () => {
  it("forces sensitive follow-ups to STAFF when a handoff is open", () => {
    const result = expectRoute("đã hoàn cọc chưa", "STAFF", {
      handoff: { open: true, reason: "refund", sensitive: true },
    });
    expect(result.reason).toBe("sensitive_followup");
    expect(result.sensitive).toBe(true);
  });

  it("keeps FAQ replies while an unrelated handoff is open", () => {
    const result = expectRoute("địa chỉ shop ở đâu", "FAQ", {
      handoff: { open: true, reason: "refund", sensitive: true },
    });
    expect(result.faqKey).toBe("address");
  });

  it("keeps money questions out of the LLM while a sensitive handoff is open", () => {
    // Giá thuê / hoàn cọc vẫn do DB + STAFF trả lời, không bao giờ để LLM tự
    // khẳng định trong lúc khách đang khiếu nại.
    const price = expectRoute("giá thuê bộ này bao nhiêu", "DB", {
      handoff: { open: true, reason: "complaint", sensitive: true },
      lastProductCard: PRODUCT_CARD,
    });
    expect(price.intent).toBe("db.product_price");

    const refund = expectRoute("đã hoàn cọc chưa", "STAFF", {
      handoff: { open: true, reason: "complaint", sensitive: true },
    });
    expect(refund.reason).toBe("sensitive_followup");
  });

  it("still gives styling advice while a sensitive handoff is open", () => {
    // Handoff TTL 24h từng làm AI im lặng cả ngày; phối đồ không thể tạo
    // cam kết tài chính nên vẫn để AI tư vấn.
    const result = expectRoute("tư vấn trang phục đi tiệc", "AI", {
      handoff: { open: true, reason: "complaint", sensitive: true },
    });
    expect(result.intent).toBe("ai.styling");
  });

  it("still gives sizing and heritage advice during a sensitive handoff", () => {
    expect(
      expectRoute("cao 1m65 nặng 50kg nên mặc size gì", "AI", {
        handoff: { open: true, reason: "refund", sensitive: true },
      }).intent,
    ).toBe("ai.sizing");

    expect(
      expectRoute("áo dài có nguồn gốc thế nào", "AI", {
        handoff: { open: true, reason: "refund", sensitive: true },
      }).intent,
    ).toBe("ai.heritage");
  });

  it("still allows advice for non-sensitive handoff reasons", () => {
    const result = expectRoute("tư vấn trang phục đi tiệc", "AI", {
      handoff: { open: true, reason: "bulk_order", sensitive: false },
    });
    expect(result.intent).toBe("ai.styling");
  });
});

describe("message classifier - slots and unknown", () => {
  it("keeps 'k' meaningful in prices, sizes and questions", () => {
    expect(normalizeForMatch("thuê 500k được không")).toBe("thue 500k duoc khong");
    expect(normalizeForMatch("áo 300k")).toBe("ao 300k");
    expect(normalizeForMatch("size k")).toBe("size k");
    expect(normalizeForMatch("shop có ship k")).toBe("shop co ship khong");

    expect(classify("thuê 500k được không").slots.productCode).toBeUndefined();
    expect(classify("áo 300k").slots.productCode).toBeUndefined();
    expect(classify("size k").route).not.toBe("STAFF");
  });

  it("distinguishes size, quantity and product codes", () => {
    const size = classify("size 5");
    expect(size.slots.size).toBe("5");
    expect(size.route).not.toBe("STAFF");

    expect(classify("5 bộ").reason).toBe("bulk_order");
    expect(classify("NB-012").reason).toBe("product_code_unsupported");
  });

  it("returns UNKNOWN for messages no rule understands", () => {
    const result = expectRoute("thời tiết hôm nay thế nào", "UNKNOWN");
    expect(result.reason).toBe("no_rule_matched");
  });

  it("returns UNKNOWN for a product card without metadata", () => {
    const result = classifyMessage({ content: "", messageType: "product_card" });
    expect(result.route).toBe("UNKNOWN");
    expect(result.missingParams).toEqual(["product"]);
  });

  it("skips unsupported message types", () => {
    const result = classifyMessage({ content: "file.pdf", messageType: "file" });
    expect(result.route).toBe("SKIP");
    expect(result.reason).toBe("unsupported_message_type");
  });
});

describe("message classifier - lọc theo khoảng giá", () => {
  const cases: Array<{
    text: string;
    priceMin?: number;
    priceMax?: number;
    color?: string;
  }> = [
    {
      text: "cho tôi các sản phẩm màu đỏ giá thuê dưới 100k",
      priceMax: 100_000,
      color: "do",
    },
    { text: "Cho tôi các áo dài duói  700k", priceMax: 700_000 },
    { text: "cho tôi các trang phục giá thuê trên 500k", priceMin: 500_000 },
    {
      text: "Cho tôi các sản phẩm từ 300 đến 1 triệu",
      priceMin: 300_000,
      priceMax: 1_000_000,
    },
    {
      text: "Cho tôi các trang phục giá từ 500k đến 10 triệu",
      priceMin: 500_000,
      priceMax: 10_000_000,
    },
  ];

  it.each(cases)("routes $text to db.catalog_price", ({ text, priceMin, priceMax, color }) => {
    const result = expectRoute(text, "DB");
    expect(result.intent).toBe("db.catalog_price");
    expect(result.slots.priceMin).toBe(priceMin);
    expect(result.slots.priceMax).toBe(priceMax);
    expect(result.slots.color).toBe(color);
    expect(result.missingParams).toEqual([]);
  });

  it("không đọc 'đến' trong khoảng giá thành màu đen", () => {
    const result = classify("từ 500k đến 10 triệu");
    expect(result.slots.color).toBeUndefined();
    expect(result.slots.priceMin).toBe(500_000);
    expect(result.slots.priceMax).toBe(10_000_000);
  });

  it("vẫn hỏi giá một mẫu cụ thể khi có màu nhưng không có khoảng giá", () => {
    const result = expectRoute("áo dài đỏ giá bao nhiêu", "DB");
    expect(result.intent).toBe("db.product_price");
    expect(result.slots.priceMin).toBeUndefined();
    expect(result.slots.priceMax).toBeUndefined();
  });

  it("không nhầm số lượng với mốc giá", () => {
    const result = classify("thuê 3 bộ vest");
    expect(result.slots.quantity).toBe(3);
    expect(result.slots.priceMin).toBeUndefined();
    expect(result.slots.priceMax).toBeUndefined();
    expect(result.route).not.toBe("DB");
  });

  it("hiểu các cách nói khoảng giá khác", () => {
    const under = classify("có mẫu nào dưới 300 nghìn không");
    expect(under.slots.priceMax).toBe(300_000);

    const over = classify("mẫu nào giá trên 200k");
    expect(over.slots.priceMin).toBe(200_000);

    const between = classify("sản phẩm 300k đến 500k");
    expect(between.slots.priceMin).toBe(300_000);
    expect(between.slots.priceMax).toBe(500_000);
  });
});

describe("message classifier - lọc theo dịp", () => {
  const catalogCases = [
    "mẫu trang phục đi tết",
    "mẫu trang phục tết",
    "có mẫu nào đi tết không",
    "shop có mẫu nào đi tết không",
    "đồ đi tết",
    "áo dài đi tết",
    "đi tiệc",
    "đồ dự tiệc",
    "đi đám cưới",
  ];

  it.each(catalogCases)("routes $0 to db.catalog_occasion", (text) => {
    const result = expectRoute(text, "DB");
    expect(result.intent).toBe("db.catalog_occasion");
    expect(result.missingParams).toEqual([]);
  });

  it("để câu hỏi tư vấn phong cách cho nhánh AI", () => {
    for (const text of [
      "tôi nên mặc đồ gì để đi tiệc",
      "nên mặc gì đi tiệc",
      "phối đồ đi tiệc",
      "tư vấn cho mình đồ đi tết",
    ]) {
      expect(expectRoute(text, "AI").intent).toBe("ai.styling");
    }
  });

  it("kết hợp dịp với khoảng giá thì vẫn là lọc giá", () => {
    const result = expectRoute("mẫu đi tết dưới 500k", "DB");
    expect(result.intent).toBe("db.catalog_price");
    expect(result.slots.priceMax).toBe(500_000);
  });

  it("không cướp câu hỏi về mẫu đang xem", () => {
    const result = expectRoute("mẫu này đi tiệc được không", "AI", withCard());
    expect(result.intent).toBe("ai.styling");
  });
});
