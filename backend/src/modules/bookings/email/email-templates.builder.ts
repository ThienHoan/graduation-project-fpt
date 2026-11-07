import { Injectable } from "@nestjs/common";
import {
  BRAND_NAME,
  DEFAULT_CUSTOMER_DASHBOARD_URL,
  DEFAULT_WEBSITE_URL,
  escapeHtml,
  formatDateDisplay,
  formatVndCurrency,
  renderCtaButton,
  renderInfoCard,
  renderNoticeBox,
  sanitizeUrl,
  wrapBaseEmailHtml,
  wrapPlainText,
} from "./email-layout";
import type {
  EmailRenderResult,
  ExtensionAppliedEmailData,
  PickupReminderEmailData,
  ReturnReminderEmailData,
  ReviewInviteEmailData,
  ThankYouVoucherEmailData,
} from "./email-templates.types";

@Injectable()
export class EmailTemplateBuilder {
  /**
   * Helper trích xuất giờ đóng cửa từ businessHours (vd: "08:00 - 20:00" -> 20:00, 20 giờ).
   */
  parseClosingTime(businessHours?: string | null): {
    closeTime: string;
    closeHour: number;
    closeMin: number;
  } | null {
    if (!businessHours || typeof businessHours !== "string") return null;
    const parts = businessHours.split(/[-–—]/);
    const target = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim();
    const match = /(\d{1,2}):(\d{2})/.exec(target);
    if (!match) return null;
    const hour = Number(match[1]);
    const min = Number(match[2]);
    if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
    return {
      closeTime: `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      closeHour: hour,
      closeMin: min,
    };
  }

  // =========================================================================
  // TEMPLATE A: PICKUP REMINDER
  // =========================================================================
  buildPickupReminderEmail(data: PickupReminderEmailData): EmailRenderResult {
    const isDelivery = String(data.pickupMethod ?? "").trim().toLowerCase() === "delivery";
    const customer = data.customerName?.trim() || "Quý khách";
    const garment = data.garmentName?.trim() || "Cổ phục Hoàng thành";
    const bookingCode = data.bookingCode?.trim() || "N/A";
    const pickupDate = formatDateDisplay(data.pickupDate);
    const ctaUrl = sanitizeUrl(data.ctaUrl, DEFAULT_CUSTOMER_DASHBOARD_URL);

    const subject = `[Nhắc lịch] Ngày mai là ngày nhận cổ phục đơn #${bookingCode}`;
    const title = `Nhắc Lịch Nhận Cổ Phục Ngày Mai`;

    const instructions = data.careInstructions && data.careInstructions.length > 0
      ? data.careInstructions
      : [
          "Bảo quản trang phục nơi khô ráo, tránh ẩm ướt và ánh nắng trực tiếp gay gắt.",
          "Không tự ý giặt máy, ủi nhiệt độ cao hoặc tẩy hoá chất lên vải lụa tơ tằm cổ phục.",
          "Giữ gìn cẩn thận các phụ kiện đi kèm (trâm cài, vấn tóc, quạt, thắt lưng, hài/guốc).",
        ];

    const instructionsHtml = instructions
      .map((inst) => `<li style="margin-bottom: 6px;">${escapeHtml(inst)}</li>`)
      .join("");

    const methodDetailHtml = isDelivery
      ? `
        <p style="margin: 0 0 10px;">
          <strong>&#128666; Phương thức nhận đồ:</strong> Giao hàng tận nơi qua đơn vị vận chuyển đối tác.
        </p>
        <p style="margin: 0; color: #57534E;">
          Nhân viên giao nhận sẽ liên hệ trước khi phát hàng. Quý khách vui lòng chú ý điện thoại để nhận trang phục đúng hẹn.
        </p>
      `
      : `
        <p style="margin: 0 0 10px;">
          <strong>&#127963; Phương thức nhận đồ:</strong> Nhận trực tiếp tại Showroom Hoàng Thành.
        </p>
        <p style="margin: 0; color: #57534E;">
          Quý khách vui lòng đến trong khung giờ hoạt động để nhân viên hỗ trợ thử đồ, kiểm tra kích thước và bàn giao phụ kiện đầy đủ.
        </p>
      `;

    const bodyHtml = `
      <p style="margin: 0 0 16px;">Kính gửi <strong>${escapeHtml(customer)}</strong>,</p>
      <p style="margin: 0 0 16px;">
        Hệ thống <strong>${BRAND_NAME}</strong> xin trân trọng thông báo: Kỳ thuê trang phục cổ phục theo đơn hàng <strong>#${escapeHtml(bookingCode)}</strong> của Quý khách sẽ bắt đầu vào ngày mai (<strong>${escapeHtml(pickupDate)}</strong>).
      </p>

      ${renderInfoCard("THÔNG TIN ĐƠN THUÊ", [
        { label: "Mã đơn hàng", value: `#${bookingCode}`, highlight: true },
        { label: "Trang phục", value: garment },
        { label: "Ngày bắt đầu thuê", value: pickupDate },
        { label: "Hình thức nhận", value: isDelivery ? "Giao tận nơi (Shipper)" : "Nhận tại Showroom" },
      ])}

      ${renderNoticeBox("info", "HƯỚNG DẪN BÀN GIAO & NHẬN ĐỒ", methodDetailHtml)}

      ${renderNoticeBox(
        "gold",
        "LƯU Ý BẢO QUẢN CỔ PHỤC QUAN TRỌNG",
        `<ul style="margin: 0; padding-left: 20px; color: #1C1917;">${instructionsHtml}</ul>`,
      )}

      ${renderCtaButton("XEM CHI TIẾT ĐƠN THUÊ", ctaUrl)}

      <p style="margin: 20px 0 0; font-size: 13px; color: #78716C; text-align: center;">
        Nếu Quý khách cần hỗ trợ thay đổi giờ nhận hoặc giao hàng, vui lòng liên hệ ngay với Hotline showroom bên dưới.
      </p>
    `;

    const text = wrapPlainText({
      title,
      bodyText: `Kính gửi ${customer},\n\nĐơn thuê #${bookingCode} (${garment}) của Quý khách bắt đầu vào ngày mai (${pickupDate}).\n\nHình thức nhận: ${isDelivery ? "Giao tận nơi" : "Nhận tại Showroom"}.\n\nLƯU Ý BẢO QUẢN:\n${instructions.map((i) => `- ${i}`).join("\n")}\n\nXem đơn hàng tại: ${ctaUrl}`,
      storeInfo: data.storeInfo,
    });

    const html = wrapBaseEmailHtml({
      title,
      preheader: `Nhắc lịch: Ngày mai (${pickupDate}) bắt đầu nhận đơn thuê cổ phục #${bookingCode}`,
      bodyHtml,
      storeInfo: data.storeInfo,
    });

    return {
      templateKey: "booking.pickup_reminder",
      subject,
      title,
      html,
      text,
    };
  }

  // =========================================================================
  // TEMPLATE B: RETURN REMINDER (DUAL 12:00 vs 17:00)
  // =========================================================================
  buildReturnReminderEmail(data: ReturnReminderEmailData): EmailRenderResult {
    const isDelivery = String(data.pickupMethod ?? "").trim().toLowerCase() === "delivery";
    const customer = data.customerName?.trim() || "Quý khách";
    const garment = data.garmentName?.trim() || "Cổ phục Hoàng thành";
    const bookingCode = data.bookingCode?.trim() || "N/A";
    const rentalEndDate = formatDateDisplay(data.rentalEndDate);
    const scheduleType = data.scheduleType ?? "daily";
    const isBeforeClose = scheduleType === "before_close";
    const ctaUrl = sanitizeUrl(data.ctaUrl, DEFAULT_CUSTOMER_DASHBOARD_URL);
    const overdueFeeStr = formatVndCurrency(data.overdueFeePerDay ?? 10_000);
    const businessHours = data.storeInfo?.businessHours || "08:00 - 20:00";

    const subject = isBeforeClose
      ? `[Cảnh báo 17h00] Sắp đến giờ đóng cửa - Hạn trả cổ phục đơn #${bookingCode}`
      : `[Nhắc hẹn] Hôm nay là hạn trả cổ phục đơn #${bookingCode}`;

    const title = isBeforeClose
      ? `Cảnh Báo Giờ Đóng Cửa - Hoàn Trả Cổ Phục`
      : `Nhắc Hạn Hoàn Trả Cổ Phục Hôm Nay`;

    // Dynamic Closing Hours Calculation for 17:00
    let timingWarningHtml = "";
    if (isBeforeClose) {
      if (isDelivery) {
        timingWarningHtml = renderNoticeBox(
          "warning",
          "NHẮC NHỞ CHIỀU - ĐƠN GIAO NHẬN TẬN NƠI",
          `Kỳ thuê đơn <strong>#${escapeHtml(bookingCode)}</strong> kết thúc hôm nay. Quý khách vui lòng kiểm tra và đóng gói toàn bộ trang phục, phụ kiện sẵn sàng để đơn vị vận chuyển đến nhận lại.`,
        );
      } else {
        const closing = this.parseClosingTime(businessHours);
        if (closing) {
          const hoursRemaining = Math.max(
            0,
            Math.floor((closing.closeHour * 60 + closing.closeMin - 17 * 60) / 60),
          );
          if (hoursRemaining > 0) {
            timingWarningHtml = renderNoticeBox(
              "warning",
              `CẢNH BÁO THỜI GIAN: CÒN KHOẢNG ${hoursRemaining} GIỜ ĐẾN GIỜ ĐÓNG CỬA`,
              `Showroom sẽ đóng cửa vào lúc <strong>${escapeHtml(closing.closeTime)}</strong>. Hiện còn khoảng <strong>${hoursRemaining} giờ (trước ${escapeHtml(closing.closeTime)})</strong> để Quý khách hoàn trả trang phục trực tiếp tại quầy và nhận bàn giao nghiệm thu.`,
            );
          } else {
            timingWarningHtml = renderNoticeBox(
              "warning",
              `LƯU Ý QUAN TRỌNG: SHOWROOM ĐÃ ĐẾN/QUA GIỜ ĐÓN KHÁCH (${escapeHtml(businessHours)})`,
              `Quý khách vui lòng <strong>không di chuyển đến cửa hàng ngoài giờ</strong>. Hãy liên hệ Hotline hoặc bấm nút bên dưới để thực hiện gia hạn thuê trực tuyến nếu cần giữ thêm đồ.`,
            );
          }
        } else {
          timingWarningHtml = renderNoticeBox(
            "warning",
            "NHẮC LẦN 2 TRƯỚC GIỜ ĐÓNG CỬA",
            `Quý khách vui lòng sắp xếp mang trang phục đến quầy trước giờ đóng cửa (${escapeHtml(businessHours)}) để nhân viên kiểm tra nhận lại đồ.`,
          );
        }
      }
    }

    // Accessory checklist
    let accessorySectionHtml = "";
    if (data.accessoryCount != null && data.accessoryCount > 0) {
      const listItems = data.accessoriesList && data.accessoriesList.length > 0
        ? data.accessoriesList.map((a) => `<li>${escapeHtml(a)}</li>`).join("")
        : `<li>Đơn hàng bao gồm <strong>${data.accessoryCount} món phụ kiện</strong> đi kèm (trâm cài, vấn tóc, quạt, guốc...).</li>`;
      accessorySectionHtml = renderNoticeBox(
        "gold",
        `KIỂM TRA PHỤ KIỆN ĐI KÈM (${data.accessoryCount} MÓN)`,
        `<p style="margin: 0 0 8px;">Quý khách vui lòng kiểm đếm đầy đủ các món phụ kiện dưới đây để bàn giao lại cho cửa hàng:</p><ul style="margin: 0; padding-left: 20px;">${listItems}</ul>`,
      );
    }

    // Pending extension warning
    let extensionNoticeHtml = "";
    if (data.hasPendingExtension) {
      extensionNoticeHtml = renderNoticeBox(
        "info",
        "YÊU CẦU GIA HẠN ĐANG CHỜ THANH TOÁN (HOLD 30 PHÚT)",
        "Đơn hàng đang có một yêu cầu gia hạn thuê chờ thanh toán qua PayOS. Quý khách vui lòng hoàn tất thanh toán trước khi hết 30 phút để ngày trả mới có hiệu lực. Nếu không thanh toán, yêu cầu sẽ tự động huỷ.",
      );
    } else {
      extensionNoticeHtml = `
        <p style="margin: 16px 0 0; font-size: 13px; color: #57534E;">
          <strong>Cần thêm thời gian thuê?</strong> Quý khách có thể gia hạn thuê trực tuyến tại trang cá nhân trước 00h00 đêm nay (tối đa 7 ngày) mà không cần đến cửa hàng.
        </p>
      `;
    }

    const bodyHtml = `
      <p style="margin: 0 0 16px;">Kính gửi <strong>${escapeHtml(customer)}</strong>,</p>
      <p style="margin: 0 0 16px;">
        Hôm nay (<strong>${escapeHtml(rentalEndDate)}</strong>) là ngày kết thúc kỳ thuê cổ phục theo đơn hàng <strong>#${escapeHtml(bookingCode)}</strong> (${escapeHtml(garment)}).
      </p>

      ${timingWarningHtml}

      ${renderInfoCard("THÔNG TIN HOÀN TRẢ ĐỒ", [
        { label: "Mã đơn hàng", value: `#${bookingCode}`, highlight: true },
        { label: "Trang phục", value: garment },
        { label: "Hạn trả đồ", value: `Hôm nay, ${rentalEndDate}` },
        { label: "Hình thức trả", value: isDelivery ? "Shipper lấy tận nơi" : "Trả tại Showroom" },
        { label: "Quy định trễ hạn", value: `Sau 00h00 tính phí ${overdueFeeStr}/ngày` },
      ])}

      ${accessorySectionHtml}

      ${renderNoticeBox(
        "info",
        "HƯỚNG DẪN CHUẨN BỊ TRANG PHỤC KHI HOÀN TRẢ",
        `<ul style="margin: 0; padding-left: 20px;">
          <li>Gấp trang phục gọn gàng và xếp vào túi/hộp ban đầu của cửa hàng.</li>
          <li>Không tự ý giặt máy, ủi nhiệt độ cao hoặc dùng hoá chất tẩy lên vải cổ phục.</li>
          <li>Báo trước với nhân viên nếu có vết bẩn phát sinh để được hỗ trợ kiểm tra nhanh chóng.</li>
        </ul>`,
      )}

      ${extensionNoticeHtml}

      ${renderCtaButton("XEM ĐƠN & GIA HẠN THUÊ", ctaUrl)}
    `;

    const text = wrapPlainText({
      title,
      bodyText: `Kính gửi ${customer},\n\nHôm nay (${rentalEndDate}) là hạn hoàn trả cổ phục đơn #${bookingCode} (${garment}).\n\nQuy định trễ hạn: Sau 00h00 hệ thống tự động tính phí quá hạn ${overdueFeeStr}/ngày.\n\nQuý khách có thể gia hạn thuê trực tuyến tại: ${ctaUrl}`,
      storeInfo: data.storeInfo,
    });

    const html = wrapBaseEmailHtml({
      title,
      preheader: isBeforeClose
        ? `Cảnh báo 17h00: Hạn hoàn trả đơn thuê #${bookingCode} hôm nay (${rentalEndDate})`
        : `Hôm nay (${rentalEndDate}) là hạn trả đơn thuê cổ phục #${bookingCode}`,
      bodyHtml,
      storeInfo: data.storeInfo,
    });

    return {
      templateKey: "booking.return_reminder",
      subject,
      title,
      html,
      text,
    };
  }

  // =========================================================================
  // TEMPLATE C: RENTAL EXTENSION CONFIRMATION
  // =========================================================================
  buildExtensionAppliedEmail(data: ExtensionAppliedEmailData): EmailRenderResult {
    // SAFETY GATE: Không bao giờ gửi email xác nhận thành công nếu trạng thái chưa phải "paid"
    const paymentStatus = String(data.paymentStatus ?? "").trim().toLowerCase();
    if (paymentStatus !== "paid") {
      throw new Error(
        `Không thể tạo email xác nhận gia hạn khi trạng thái thanh toán là '${data.paymentStatus}'. Chỉ gửi khi paymentStatus === 'paid'.`,
      );
    }

    const customer = data.customerName?.trim() || "Quý khách";
    const garment = data.garmentName?.trim() || "Cổ phục Hoàng thành";
    const bookingCode = data.bookingCode?.trim() || "N/A";
    const originalEnd = formatDateDisplay(data.originalEndDate);
    const newEnd = formatDateDisplay(data.newEndDate);
    const feeStr = formatVndCurrency(data.extensionFee);
    const ctaUrl = sanitizeUrl(data.ctaUrl, DEFAULT_CUSTOMER_DASHBOARD_URL);

    const subject = `[Xác nhận] Gia hạn thuê cổ phục thành công đơn #${bookingCode}`;
    const title = `Xác Nhận Gia Hạn Thuê Cổ Phục Thành Công`;

    const bodyHtml = `
      <p style="margin: 0 0 16px;">Kính gửi <strong>${escapeHtml(customer)}</strong>,</p>
      <p style="margin: 0 0 16px;">
        Hệ thống <strong>${BRAND_NAME}</strong> xin trân trọng xác nhận: Yêu cầu gia hạn kỳ thuê cho đơn hàng <strong>#${escapeHtml(bookingCode)}</strong> đã được thanh toán và cập nhật thành công!
      </p>

      ${renderInfoCard("CHI TIẾT GIA HẠN KỲ THUÊ", [
        { label: "Mã đơn hàng", value: `#${bookingCode}` },
        { label: "Trang phục", value: garment },
        { label: "Ngày trả ban đầu", value: originalEnd },
        { label: "Hạn trả mới chính thức", value: newEnd, highlight: true },
        { label: "Thời gian gia hạn thêm", value: `+${data.extensionDays} ngày` },
        { label: "Phí gia hạn đã thanh toán", value: feeStr, highlight: true },
        { label: "Trạng thái thanh toán", value: "Đã thanh toán thành công qua PayOS" },
      ])}

      ${renderNoticeBox(
        "success",
        "LỊCH THUÊ ĐÃ ĐƯỢC BẢO LƯU TỰ ĐỘNG",
        `Hệ thống đã tự động khoá lịch kho và bảo lưu trang phục <strong>${escapeHtml(garment)}</strong> đến hết ngày <strong>${escapeHtml(newEnd)}</strong>. Quý khách an tâm trải nghiệm thêm mà không phát sinh phí phạt quá hạn trong khoảng thời gian này.`,
      )}

      ${renderCtaButton("XEM LỊCH THUÊ MỚI TRÊN DASHBOARD", ctaUrl)}

      <p style="margin: 20px 0 0; font-size: 13px; color: #78716C; text-align: center;">
        Cảm ơn Quý khách đã luôn tin yêu và đồng hành cùng nét đẹp cổ phục Hoàng Thành.
      </p>
    `;

    const text = wrapPlainText({
      title,
      bodyText: `Kính gửi ${customer},\n\nGia hạn thuê đơn #${bookingCode} (${garment}) đã thanh toán thành công!\n\n- Ngày trả ban đầu: ${originalEnd}\n- Hạn trả mới chính thức: ${newEnd} (+${data.extensionDays} ngày)\n- Phí gia hạn: ${feeStr} (Đã thanh toán)\n\nXem thông tin tại: ${ctaUrl}`,
      storeInfo: data.storeInfo,
    });

    const html = wrapBaseEmailHtml({
      title,
      preheader: `Xác nhận: Đơn #${bookingCode} đã được gia hạn thành công đến ngày ${newEnd}`,
      bodyHtml,
      storeInfo: data.storeInfo,
    });

    return {
      templateKey: "booking.extension_applied",
      subject,
      title,
      html,
      text,
    };
  }

  // =========================================================================
  // TEMPLATE D: THANK-YOU & VOUCHER (SAFETY GATE STRICT ENFORCEMENT)
  // =========================================================================
  buildThankYouVoucherEmail(data: ThankYouVoucherEmailData): EmailRenderResult {
    const customer = data.customerName?.trim() || "Quý khách";
    const garment = data.garmentName?.trim() || "Cổ phục Hoàng thành";
    const bookingCode = data.bookingCode?.trim() || "N/A";
    const ctaUrl = sanitizeUrl(data.ctaUrl, `${DEFAULT_WEBSITE_URL}/catalog`);

    // SAFETY GATE:
    // Nếu chương trình đang DISABLED (hoặc không có voucherCode hợp lệ),
    // TUYỆT ĐỐI KHÔNG render thẻ voucher, không in mã, không quảng cáo được tặng voucher.
    const isProgramActive = Boolean(data.programEnabled) && Boolean(data.voucherCode?.trim());

    const subject = isProgramActive
      ? `[Tặng Voucher Tri Ân] Cảm ơn Quý khách đã hoàn tất đơn #${bookingCode}`
      : `[Tri ân] Cảm ơn Quý khách đã hoàn tất kỳ thuê đơn #${bookingCode}`;

    const title = isProgramActive
      ? `Món Quà Tri Ân Dành Riêng Cho Quý Khách`
      : `Lời Tri Ân Từ Cổ Phục Hoàng Thành`;

    let voucherSectionHtml = "";
    if (isProgramActive) {
      const code = escapeHtml(data.voucherCode!.trim());
      const discountText =
        data.discountType === "percentage"
          ? `Giảm ${data.discountValue}%`
          : `Giảm ${formatVndCurrency(data.discountValue)}`;
      const expiryText = data.expiresAt ? formatDateDisplay(data.expiresAt) : "30 ngày kể từ ngày nhận";
      const minOrderText = data.minOrderValue ? `Đơn tối thiểu: ${formatVndCurrency(data.minOrderValue)}` : "";
      const maxDiscountText =
        data.maxDiscountAmount && data.discountType === "percentage"
          ? ` (Tối đa ${formatVndCurrency(data.maxDiscountAmount)})`
          : "";

      voucherSectionHtml = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; background: linear-gradient(135deg, #FFFDF8 0%, #FAF3E6 100%); border: 2px dashed #D4AF37; border-radius: 12px; padding: 24px; text-align: center;">
          <tr>
            <td>
              <div style="font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #881337; font-weight: 700; margin-bottom: 6px;">
                &#10024; VOUCHER TRI ÂN KHÁCH HÀNG THÂN THIẾT &#10024;
              </div>
              <div style="font-family: 'Times New Roman', Georgia, serif; font-size: 26px; font-weight: 700; color: #881337; margin-bottom: 8px;">
                ${escapeHtml(discountText)}${escapeHtml(maxDiscountText)}
              </div>
              <div style="display: inline-block; background: #881337; color: #FFFFFF; font-family: monospace; font-size: 18px; font-weight: 700; padding: 8px 24px; border-radius: 6px; letter-spacing: 0.15em; margin: 10px 0;">
                ${code}
              </div>
              <div style="font-size: 12px; color: #57534E; margin-top: 8px; line-height: 1.6;">
                Hạn sử dụng đến: <strong>${escapeHtml(expiryText)}</strong><br>
                ${minOrderText ? escapeHtml(minOrderText) + " &nbsp;|&nbsp; " : ""}Áp dụng cho lần thuê tiếp theo trên toàn hệ thống.
              </div>
            </td>
          </tr>
        </table>
      `;
    }

    const bodyHtml = `
      <p style="margin: 0 0 16px;">Kính gửi <strong>${escapeHtml(customer)}</strong>,</p>
      <p style="margin: 0 0 16px;">
        Đơn thuê cổ phục <strong>#${escapeHtml(bookingCode)}</strong> (${escapeHtml(garment)}) của Quý khách đã được hoàn tất thủ tục bàn giao và nghiệm thu thành công.
      </p>
      <p style="margin: 0 0 16px;">
        Đội ngũ <strong>${BRAND_NAME}</strong> xin chân thành cảm ơn Quý khách đã tin tưởng lựa chọn chúng tôi để đồng hành trong những khoảnh khắc văn hoá ý nghĩa. Niềm vinh hạnh của chúng tôi là được cùng Quý khách tôn vinh nét đẹp y phục truyền thống Việt Nam.
      </p>

      ${voucherSectionHtml}

      ${renderInfoCard("THÔNG TIN ĐƠN HOÀN TẤT", [
        { label: "Mã đơn hàng", value: `#${bookingCode}` },
        { label: "Trang phục đã thuê", value: garment },
        { label: "Trạng thái", value: "Đã hoàn tất nghiệm thu & nhận đồ" },
      ])}

      ${renderCtaButton(
        isProgramActive ? "ÁP DỤNG VOUCHER & ĐẶT THUÊ NGAY" : "KHÁM PHÁ BỘ SƯU TẬP MỚI",
        ctaUrl,
      )}

      <p style="margin: 20px 0 0; font-size: 13px; color: #78716C; text-align: center;">
        Kính chúc Quý khách luôn nhiều niềm vui, an khang và tiếp tục gắn bó cùng Cổ Phục Hoàng Thành.
      </p>
    `;

    const text = wrapPlainText({
      title,
      bodyText: isProgramActive
        ? `Kính gửi ${customer},\n\nCảm ơn Quý khách đã hoàn tất đơn thuê #${bookingCode} (${garment})!\n\nMÓN QUÀ TRI ÂN:\nMã voucher: ${data.voucherCode}\nƯu đãi: ${data.discountValue}${data.discountType === "percentage" ? "%" : "đ"}\n\nĐặt thuê lần tiếp theo tại: ${ctaUrl}`
        : `Kính gửi ${customer},\n\nCảm ơn Quý khách đã hoàn tất đơn thuê #${bookingCode} (${garment}) tại ${BRAND_NAME}!\n\nKhám phá bộ sưu tập mới tại: ${ctaUrl}`,
      storeInfo: data.storeInfo,
    });

    const html = wrapBaseEmailHtml({
      title,
      preheader: `Lời tri ân chân thành từ ${BRAND_NAME} cho đơn hàng #${bookingCode}`,
      bodyHtml,
      storeInfo: data.storeInfo,
    });

    return {
      templateKey: "booking.thank_you_voucher",
      subject,
      title,
      html,
      text,
    };
  }

  // =========================================================================
  // TEMPLATE E: REVIEW INVITATION
  // =========================================================================
  buildReviewInviteEmail(data: ReviewInviteEmailData): EmailRenderResult {
    const customer = data.customerName?.trim() || "Quý khách";
    const garment = data.garmentName?.trim() || "Cổ phục Hoàng thành";
    const bookingCode = data.bookingCode?.trim() || "N/A";
    const ctaUrl = sanitizeUrl(data.ctaUrl, DEFAULT_CUSTOMER_DASHBOARD_URL);

    const subject = `[Mời đánh giá] Cảm nhận của Quý khách về bộ cổ phục đơn #${bookingCode}?`;
    const title = `Mời Đánh Giá Trải Nghiệm Cổ Phục Hoàng Thành`;

    const bodyHtml = `
      <p style="margin: 0 0 16px;">Kính gửi <strong>${escapeHtml(customer)}</strong>,</p>
      <p style="margin: 0 0 16px;">
        Vừa qua, Quý khách đã hoàn tất kỳ thuê bộ trang phục <strong>${escapeHtml(garment)}</strong> (đơn hàng <strong>#${escapeHtml(bookingCode)}</strong>).
      </p>
      <p style="margin: 0 0 16px;">
        Chúng tôi rất mong muốn được lắng nghe cảm nhận thực tế của Quý khách về chất lượng vải, độ vừa vặn của size áo cũng như thái độ phục vụ của nhân viên tại showroom.
      </p>

      <!-- 5-STAR RATING INVITATION BANNER -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; background: #FAF8F5; border: 1px solid #E8DFD1; border-radius: 12px; padding: 24px; text-align: center;">
        <tr>
          <td>
            <div style="font-size: 28px; letter-spacing: 0.25em; color: #D4AF37; margin-bottom: 10px;">
              ★ ★ ★ ★ ★
            </div>
            <div style="font-family: 'Times New Roman', Georgia, serif; font-size: 16px; font-weight: 700; color: #881337; margin-bottom: 6px;">
              Quý khách có hài lòng với trải nghiệm lần này?
            </div>
            <div style="font-size: 13px; color: #57534E;">
              Chỉ mất 1 phút để chia sẻ ý kiến giúp chúng tôi không ngừng nâng cao chất lượng dịch vụ.
            </div>
          </td>
        </tr>
      </table>

      ${renderInfoCard("THÔNG TIN ĐƠN ĐÁNH GIÁ", [
        { label: "Mã đơn hàng", value: `#${bookingCode}` },
        { label: "Trang phục", value: garment },
      ])}

      ${renderCtaButton("ĐÁNH GIÁ TRẢI NGHIỆM NGAY", ctaUrl)}

      <p style="margin: 20px 0 0; font-size: 13px; color: #78716C; text-align: center;">
        Đường dẫn đánh giá được bảo mật và liên kết trực tiếp vào trang cá nhân của Quý khách.
      </p>
    `;

    const text = wrapPlainText({
      title,
      bodyText: `Kính gửi ${customer},\n\nCảm ơn Quý khách đã trải nghiệm ${garment} (đơn #${bookingCode}).\n\nQuý khách vui lòng dành 1 phút để gửi phản hồi đánh giá giúp chúng tôi hoàn thiện hơn tại:\n${ctaUrl}`,
      storeInfo: data.storeInfo,
    });

    const html = wrapBaseEmailHtml({
      title,
      preheader: `Mời đánh giá trải nghiệm đơn thuê cổ phục #${bookingCode} (${garment})`,
      bodyHtml,
      storeInfo: data.storeInfo,
    });

    return {
      templateKey: "booking.review_invite",
      subject,
      title,
      html,
      text,
    };
  }
}
