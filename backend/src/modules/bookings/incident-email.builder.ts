/**
 * Email giao dịch cho luồng sự cố trước bàn giao.
 *
 * Toàn bộ nội dung do server dựng từ dữ liệu đơn hàng; mọi giá trị động đều
 * được escape trước khi chèn vào HTML (tên khách, tên sản phẩm, lý do, lời nhắn
 * quản lý nhập). Ảnh chỉ nhận http/https để tránh chèn scheme nguy hiểm.
 *
 * Khung email (header/footer) sao chép từ `wrapEmailHtml` của
 * `notifications.service.ts` để email sự cố trông giống các email hệ thống khác.
 */

export type IncidentEmailItem = {
  name: string;
  sizeLabel?: string | null;
  imageUrl?: string | null;
  quantity?: number | null;
  price?: number | null;
  /** Loại sự cố của món (nhãn tiếng Việt), chỉ có ở danh sách món bị ảnh hưởng. */
  note?: string | null;
};

export type IncidentProposalEmailInput = {
  bookingId: string;
  bookingCode: string;
  customerName?: string | null;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  affectedItems: IncidentEmailItem[];
  proposedItems: IncidentEmailItem[];
  rentBefore: number;
  rentAfter: number;
  depositBefore?: number;
  depositAfter?: number;
  chargeNow: number;
  creditAmount?: number;
  reason: string;
  holdExpiresAt: Date;
  actionUrl: string;
  emailSubject?: string | null;
  emailMessage?: string | null;
};

export type IncidentRemovalEmailInput = {
  bookingId: string;
  bookingCode: string;
  customerName?: string | null;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  removedItems: IncidentEmailItem[];
  beforeRentalTotal: number;
  afterRentalTotal: number;
  beforeDepositTotal?: number;
  afterDepositTotal?: number;
  cancelled: boolean;
  reason: string;
  refundAmount?: number;
  /** Phần giảm ghi nhận hoàn khi trả đồ (đơn đã thanh toán, chưa huỷ đơn). */
  creditAmount?: number;
  /** Nhãn trạng thái đơn ở mục 1. Bỏ trống → "Đã cập nhật" (hoặc "Đã hủy"). */
  statusLabel?: string | null;
  actionUrl: string;
  emailSubject?: string | null;
  emailMessage?: string | null;
};

export type IncidentCancellationEmailInput = {
  bookingId: string;
  bookingCode: string;
  customerName?: string | null;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  items: IncidentEmailItem[];
  reason: string;
  refundAmount?: number;
  beforeRentalTotal?: number;
  afterRentalTotal?: number;
  beforeDepositTotal?: number;
  afterDepositTotal?: number;
  /** Nhãn trạng thái đơn ở mục 1. Bỏ trống → "Đã hủy". */
  statusLabel?: string | null;
  actionUrl: string;
  emailSubject?: string | null;
  emailMessage?: string | null;
};

const SHOP_NAME = "Cổ Phục Rental";
const BRAND = "Cổ Phục ERP";
/** Nhãn trạng thái mặc định cho email "đơn đã huỷ" / "đơn đã cập nhật". */
const CANCELLED_LABEL = "Đã hủy";
const UPDATED_LABEL = "Đã cập nhật";
const VIOLET = "#8B0000";
const GOLD = "#D4A017";
const INK = "#1a1a2e";
const TEXT = "#4a4a5a";
const MUTED = "#6b6b7b";
const SAND = "#e8e0d5";
const CREAM = "#faf6f1";

export function appBaseUrl(): string {
  return (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function incidentActionUrl(bookingId: string): string {
  return `${appBaseUrl()}/booking/incidents/${encodeURIComponent(bookingId)}`;
}

export function proposalEmailSubject(bookingCode: string): string {
  return `Đề xuất đổi mẫu cho đơn #${bookingCode}`;
}

export function removalEmailSubject(bookingCode: string): string {
  return `Cập nhật đơn #${bookingCode} sau khi bỏ món`;
}

export function cancellationEmailSubject(bookingCode: string): string {
  return `Đơn thuê #${bookingCode} đã bị huỷ`;
}

export function buildProposalEmail(input: IncidentProposalEmailInput): string {
  const diff = input.rentAfter - input.rentBefore;
  const summaryRows = [
    row("Tiền thuê trước thay đổi", formatVnd(input.rentBefore)),
    row("Tiền thuê sau thay đổi", formatVnd(input.rentAfter)),
    row("Chênh lệch tiền thuê", `${diff >= 0 ? "+" : "−"}${formatVnd(Math.abs(diff))}`),
  ];
  if (typeof input.depositBefore === "number" && typeof input.depositAfter === "number" && input.depositBefore !== input.depositAfter) {
    summaryRows.push(row("Tiền cọc trước / sau", `${formatVnd(input.depositBefore)} → ${formatVnd(input.depositAfter)}`));
  }

  const chargeText =
    input.chargeNow > 0
      ? `Bạn cần thanh toán thêm <strong>${formatVnd(input.chargeNow)}</strong> khi xác nhận.`
      : input.chargeNow < 0
        ? `Bạn được giảm <strong>${formatVnd(Math.abs(input.chargeNow))}</strong>.`
        : "Không phát sinh chênh lệch cần thanh toán.";
  const creditText =
    input.creditAmount && input.creditAmount > 0
      ? `<p style="${pStyle}">Phần giảm <strong>${formatVnd(input.creditAmount)}</strong> sẽ được ghi nhận hoàn khi trả đồ theo chính sách.</p>`
      : "";

  const body = `
    ${greeting(input.customerName)}
    <p style="${pStyle}">
      ${escapeHtml(input.emailMessage?.trim() || `${SHOP_NAME} xin thông báo một món trong đơn thuê của bạn gặp sự cố và cửa hàng đã chuẩn bị phương án thay thế.`)}
    </p>
    ${infoBox(
      "Thông tin đơn hiện tại",
      `<p style="${pStyle}"><strong>Mã đơn:</strong> #${escapeHtml(input.bookingCode)}</p>
       <p style="${pStyle}"><strong>Thời gian thuê:</strong> ${formatDate(input.rentalStartDate)} – ${formatDate(input.rentalEndDate)}</p>
       <p style="${pStyle}"><strong>Tiền thuê hiện tại:</strong> ${formatVnd(input.rentBefore)}</p>`,
    )}
    ${sectionTitle("Sản phẩm đang gặp sự cố")}
    ${itemList(input.affectedItems)}
    ${sectionTitle("Phương án thay thế đề xuất")}
    ${itemList(input.proposedItems)}
    ${sectionTitle("Giá và chênh lệch")}
    ${summaryTable(summaryRows)}
    <p style="${pStyle}">${chargeText}</p>
    ${creditText}
    ${infoBox("Lý do đề xuất", `<p style="${pStyle}">${escapeHtml(input.reason)}</p>`)}
    ${infoBox(
      "Thời hạn giữ chỗ",
      `<p style="${pStyle}">Mẫu thay thế được giữ đến <strong>${formatDateTime(input.holdExpiresAt)}</strong> (30 phút kể từ khi gửi). Sau thời hạn này, cửa hàng sẽ giải phóng mẫu và tiếp tục xử lý sự cố.</p>`,
    )}
    ${ctaButton(input.actionUrl, "Xem đề xuất và xác nhận")}
  `;

  return wrap(input.emailSubject?.trim() || proposalEmailSubject(input.bookingCode), body);
}

export function buildRemovalEmail(input: IncidentRemovalEmailInput): string {
  // Bỏ HẾT trang phục → đơn bị huỷ: dùng chung bố cục email huỷ đơn (4 mục).
  if (input.cancelled) {
    return buildCancelledBookingEmail({
      bookingCode: input.bookingCode,
      customerName: input.customerName,
      rentalStartDate: input.rentalStartDate,
      rentalEndDate: input.rentalEndDate,
      items: input.removedItems,
      reason: input.reason,
      refundAmount: input.refundAmount,
      beforeRentalTotal: input.beforeRentalTotal,
      afterRentalTotal: input.afterRentalTotal,
      beforeDepositTotal: input.beforeDepositTotal,
      afterDepositTotal: input.afterDepositTotal,
      statusLabel: input.statusLabel,
      actionUrl: input.actionUrl,
      emailSubject: input.emailSubject,
      emailMessage: input.emailMessage,
    });
  }

  const credit = Math.max(0, Number(input.creditAmount ?? 0));
  const intro =
    input.emailMessage?.trim() ||
    `${SHOP_NAME} xin thông báo đã gỡ các món gặp sự cố khỏi đơn thuê của bạn.`;

  const body = `
    ${emailTitle("Đơn thuê đã được cập nhật", input.bookingCode, input.statusLabel?.trim() || UPDATED_LABEL)}
    ${greeting(input.customerName)}
    <p style="${pStyle}">${escapeHtml(intro)}</p>
    ${reasonNote(input.reason, input.emailMessage)}
    ${bookingInfoSection({
      bookingCode: input.bookingCode,
      rentalStartDate: input.rentalStartDate,
      rentalEndDate: input.rentalEndDate,
      statusLabel: input.statusLabel?.trim() || UPDATED_LABEL,
    })}
    ${numberedHeading(2, "Trang phục gặp sự cố")}
    ${incidentItemList(input.removedItems)}
    ${numberedHeading(3, "Thay đổi giá trị đơn hàng")}
    ${amountChangeTable([
      {
        label: "Tiền thuê",
        before: input.beforeRentalTotal,
        after: input.afterRentalTotal,
      },
      {
        label: "Tiền cọc",
        before: Number(input.beforeDepositTotal ?? 0),
        after: Number(input.afterDepositTotal ?? 0),
      },
    ])}
    ${numberedHeading(4, "Thông tin hoàn tiền")}
    ${refundBlock(
      credit,
      credit > 0
        ? "Phần giảm này được ghi nhận hoàn khi bạn trả đồ theo chính sách của cửa hàng."
        : "Thay đổi này không phát sinh khoản tiền hoàn.",
    )}
    ${ctaButton(input.actionUrl, "Xem chi tiết đơn thuê")}
  `;

  return wrap(input.emailSubject?.trim() || removalEmailSubject(input.bookingCode), body);
}

export function buildCancellationEmail(input: IncidentCancellationEmailInput): string {
  return buildCancelledBookingEmail({
    bookingCode: input.bookingCode,
    customerName: input.customerName,
    rentalStartDate: input.rentalStartDate,
    rentalEndDate: input.rentalEndDate,
    items: input.items,
    reason: input.reason,
    refundAmount: input.refundAmount,
    beforeRentalTotal: Number(input.beforeRentalTotal ?? 0),
    afterRentalTotal: Number(input.afterRentalTotal ?? 0),
    beforeDepositTotal: Number(input.beforeDepositTotal ?? 0),
    afterDepositTotal: Number(input.afterDepositTotal ?? 0),
    statusLabel: input.statusLabel,
    actionUrl: input.actionUrl,
    emailSubject: input.emailSubject,
    emailMessage: input.emailMessage,
  });
}

/**
 * Email "đơn đã bị huỷ" — dùng chung cho huỷ đơn trực tiếp và bỏ hết món.
 *
 * Bố cục 4 mục cố định để khách đọc được ngay: đơn nào, món nào gặp sự cố, tiền
 * thay đổi ra sao, và được hoàn bao nhiêu.
 */
function buildCancelledBookingEmail(input: {
  bookingCode: string;
  customerName?: string | null;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  items: IncidentEmailItem[];
  reason: string;
  refundAmount?: number;
  beforeRentalTotal: number;
  afterRentalTotal: number;
  beforeDepositTotal?: number;
  afterDepositTotal?: number;
  statusLabel?: string | null;
  actionUrl: string;
  emailSubject?: string | null;
  emailMessage?: string | null;
}): string {
  const refund = Math.max(0, Number(input.refundAmount ?? 0));
  // Lý do trong câu mở đầu lấy theo đúng loại sự cố của từng món (khớp mục 2).
  const reasons = [
    ...new Set(
      input.items
        .map((item) => item.note?.trim())
        .filter((note): note is string => Boolean(note)),
    ),
  ];
  const cause =
    reasons.length > 0
      ? `trang phục gặp sự cố ${reasons.map(lowerFirst).join(", ")}`
      : input.reason.trim() || "trang phục gặp sự cố không thể khắc phục";
  const intro =
    input.emailMessage?.trim() ||
    `Rất tiếc, ${SHOP_NAME} xin thông báo đơn thuê của bạn đã bị hủy do ${cause} và không còn sản phẩm nào trong đơn.`;

  const body = `
    ${emailTitle("Đơn thuê đã bị hủy", input.bookingCode, input.statusLabel?.trim() || CANCELLED_LABEL)}
    ${greeting(input.customerName)}
    <p style="${pStyle}">${escapeHtml(intro)}</p>
    ${reasonNote(input.reason, input.emailMessage)}
    ${bookingInfoSection({
      bookingCode: input.bookingCode,
      rentalStartDate: input.rentalStartDate,
      rentalEndDate: input.rentalEndDate,
      statusLabel: input.statusLabel?.trim() || CANCELLED_LABEL,
    })}
    ${numberedHeading(2, reasons.length > 0 ? "Trang phục gặp sự cố" : "Trang phục trong đơn")}
    ${incidentItemList(input.items)}
    ${numberedHeading(3, "Thay đổi giá trị đơn hàng")}
    ${amountChangeTable([
      { label: "Tiền thuê", before: input.beforeRentalTotal, after: input.afterRentalTotal },
      {
        label: "Tiền cọc",
        before: Number(input.beforeDepositTotal ?? 0),
        after: Number(input.afterDepositTotal ?? 0),
      },
    ])}
    ${numberedHeading(4, "Thông tin hoàn tiền")}
    ${refundBlock(
      refund,
      refund > 0
        ? "Cửa hàng sẽ xác nhận và hoàn tiền theo chính sách (chuyển khoản hoặc tiền mặt tại quầy)."
        : "Đơn chưa ghi nhận khoản thanh toán nào nên không phát sinh tiền hoàn.",
    )}
    ${ctaButton(input.actionUrl, "Xem chi tiết đơn thuê")}
  `;

  return wrap(input.emailSubject?.trim() || cancellationEmailSubject(input.bookingCode), body);
}

/** Khung ngoài — sao chép cấu trúc `wrapEmailHtml` của notifications.service. */
function wrap(subject: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)} — ${BRAND}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f0eb;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0eb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          ${brandHeader()}
          ${divider()}
          <tr>
            <td style="background:#ffffff;padding:32px 40px 24px;font-size:15px;line-height:1.7;color:${TEXT};">
              ${body}
            </td>
          </tr>
          ${supportCard()}
          ${footer()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function brandHeader(): string {
  return `<tr>
    <td style="background:linear-gradient(135deg,#8B0000 0%,#a31515 50%,#c0392b 100%);border-radius:16px 16px 0 0;padding:36px 40px 28px;text-align:center;">
      <div style="margin-bottom:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="width:48px;height:48px;background:rgba(255,255,255,0.15);border-radius:12px;text-align:center;vertical-align:middle;">
              <span style="font-size:24px;color:#FFD700;">&#9734;</span>
            </td>
          </tr>
        </table>
      </div>
      <div style="font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:rgba(255,215,0,0.9);font-weight:700;margin-bottom:8px;">${BRAND}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7);font-weight:400;">Hệ thống quản lý cho thuê trang phục cổ phục</div>
    </td>
  </tr>`;
}

function divider(): string {
  return `<tr>
    <td style="background:#ffffff;padding:0 40px;">
      <div style="height:4px;background:linear-gradient(90deg,#8B0000,#D4A017,#8B0000);border-radius:2px;"></div>
    </td>
  </tr>`;
}

function supportCard(): string {
  return `<tr>
    <td style="background:#ffffff;padding:0 40px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:${CREAM};border:1px solid ${SAND};border-radius:12px;padding:20px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:36px;vertical-align:top;">
                  <div style="width:32px;height:32px;background:linear-gradient(135deg,#8B0000,#D4A017);border-radius:8px;text-align:center;line-height:32px;">
                    <span style="color:#fff;font-size:16px;">&#9993;</span>
                  </div>
                </td>
                <td style="padding-left:12px;vertical-align:top;">
                  <div style="font-size:13px;font-weight:600;color:${VIOLET};margin-bottom:4px;">Cần hỗ trợ?</div>
                  <div style="font-size:13px;color:${MUTED};line-height:1.6;">Nếu bạn có thắc mắc, vui lòng liên hệ đội ngũ chăm sóc khách hàng qua email hoặc hotline bên dưới.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function footer(): string {
  return `<tr>
    <td style="background:#1a1a2e;border-radius:0 0 16px 16px;padding:28px 40px;text-align:center;">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:${GOLD};margin-bottom:12px;">${BRAND}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.8;">
        Email: cophuctruyenthong@gmail.com &nbsp;|&nbsp; Hotline: 1900 xxxx<br>
        Đà Nẵng, Việt Nam
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
        <div style="font-size:11px;color:rgba(255,255,255,0.35);line-height:1.6;">
          &copy; 2026 ${BRAND}. Bạn nhận email này vì đã đăng ký tài khoản trên hệ thống.<br>
          Đây là email tự động, vui lòng không trả lời trực tiếp.
        </div>
      </div>
    </td>
  </tr>`;
}

function greeting(customerName?: string | null): string {
  const name = customerName?.trim();
  return `<p style="margin:0 0 14px;font-size:16px;line-height:26px;color:${INK}">${name ? `Chào ${escapeHtml(name)},` : "Chào bạn,"}</p>`;
}

/**
 * Lý do cửa hàng nhập (hiển thị cho khách) — chỉ thêm khi khách chưa tự viết
 * lời nhắn riêng, tránh lặp ý.
 */
function reasonNote(reason: string, emailMessage?: string | null): string {
  const text = reason.trim();
  if (!text || emailMessage?.trim()) return "";
  return `<p style="${pStyle}"><strong>Ghi chú từ cửa hàng:</strong> ${escapeHtml(text)}</p>`;
}

function sectionTitle(text: string): string {
  return `<p style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${VIOLET}">${escapeHtml(text)}</p>`;
}

/**
 * Tiêu đề email dạng "trang bìa": tên trạng thái + mã đơn + nhãn trạng thái.
 * Khách mở mail là biết ngay đơn nào, đang ở trạng thái gì.
 */
function emailTitle(title: string, bookingCode: string, statusLabel: string): string {
  const danger = statusLabel === CANCELLED_LABEL;
  const badge = danger
    ? `background:#fdecec;border:1px solid #f3c7c7;color:${VIOLET}`
    : `background:#eef6f1;border:1px solid #c7e3d4;color:#0f6b47`;
  return `<div style="margin:0 0 22px">
    <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:32px;font-weight:700;color:${INK}">${escapeHtml(title)}</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:22px;color:${TEXT}">Mã đơn <strong style="color:${INK}">#${escapeHtml(bookingCode)}</strong></p>
    <span style="display:inline-block;padding:5px 14px;border-radius:999px;${badge};font-size:12px;font-weight:700">${escapeHtml(statusLabel)}</span>
  </div>`;
}

/** Tiêu đề mục có số thứ tự: "1. Thông tin đơn thuê". */
function numberedHeading(index: number, title: string): string {
  return `<h2 style="margin:26px 0 10px;font-size:15px;line-height:22px;font-weight:700;color:${INK}">${index}. ${escapeHtml(title)}</h2>`;
}

const cellHead = `padding:10px 14px;border:1px solid ${SAND};background:${CREAM};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}`;
const cellLabel = `padding:10px 14px;border:1px solid ${SAND};background:#fffdfa;font-size:13px;color:${MUTED};width:40%`;
const cellValue = `padding:10px 14px;border:1px solid ${SAND};font-size:13px;font-weight:600;color:${INK}`;

/** Bảng "Thông tin | Chi tiết" của mục 1. */
function detailTable(rows: Array<{ label: string; value: string }>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0">
    <tr>
      <td style="${cellHead}">Thông tin</td>
      <td style="${cellHead}">Chi tiết</td>
    </tr>
    ${rows
      .map(
        (itemRow) => `<tr>
          <td style="${cellLabel}">${escapeHtml(itemRow.label)}</td>
          <td style="${cellValue}">${escapeHtml(itemRow.value)}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

/** Mục 1 dùng chung cho email huỷ đơn và email bỏ món. */
function bookingInfoSection(input: {
  bookingCode: string;
  rentalStartDate: Date | string;
  rentalEndDate: Date | string;
  statusLabel: string;
}): string {
  return `${numberedHeading(1, "Thông tin đơn thuê")}
    ${detailTable([
      { label: "Mã đơn", value: `#${input.bookingCode}` },
      { label: "Ngày thuê", value: formatRentalRange(input.rentalStartDate, input.rentalEndDate) },
      { label: "Trạng thái", value: input.statusLabel },
    ])}`;
}

/** Bảng "Khoản tiền | Trước | Sau" của mục 3. */
function amountChangeTable(rows: Array<{ label: string; before: number; after: number }>): string {
  const headCell = (align: "left" | "right") =>
    `${cellHead};text-align:${align}`;
  const cells = (align: "left" | "right", weight: "400" | "700", color: string) =>
    `padding:10px 14px;border:1px solid ${SAND};font-size:13px;text-align:${align};font-weight:${weight};color:${color}`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0">
    <tr>
      <td style="${headCell("left")}">Khoản tiền</td>
      <td style="${headCell("right")}">Trước</td>
      <td style="${headCell("right")}">Sau</td>
    </tr>
    ${rows
      .map(
        (moneyRow) => `<tr>
          <td style="${cells("left", "400", MUTED)}">${escapeHtml(moneyRow.label)}</td>
          <td style="${cells("right", "700", TEXT)}">${escapeHtml(formatVnd(moneyRow.before))}</td>
          <td style="${cells("right", "700", INK)}">${escapeHtml(formatVnd(moneyRow.after))}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

/**
 * Mục 2: danh sách món bị sự cố — ảnh, tên, SỐ LƯỢNG, LÝ DO và giá của TỪNG
 * dòng. Dùng bảng (không flexbox) để Outlook/Gmail cũ vẫn hiển thị đúng.
 */
function incidentItemList(items: IncidentEmailItem[]): string {
  if (items.length === 0) {
    return `<p style="margin:0 0 12px;font-size:14px;color:${MUTED}">Không có món nào.</p>`;
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0">
    ${items
      .map((item) => {
        const image = safeImageUrl(item.imageUrl);
        const quantity = Math.max(1, Number(item.quantity ?? 1));
        const price =
          typeof item.price === "number" && item.price > 0 ? formatVnd(item.price) : "Miễn phí";
        const thumb = image
          ? `<img src="${escapeHtml(image)}" alt="" width="64" height="80" style="display:block;width:64px;height:80px;object-fit:cover;border-radius:8px;border:1px solid ${SAND}" />`
          : `<div style="width:64px;height:80px;border-radius:8px;background:#ffffff;border:1px solid ${SAND}"></div>`;
        return `<tr>
          <td style="padding:12px;background:${CREAM};border:1px solid ${SAND};border-radius:10px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
              <tr>
                <td width="64" valign="top" style="width:64px">${thumb}</td>
                <td valign="top" style="padding-left:14px">
                  <p style="margin:0;font-size:15px;line-height:21px;font-weight:700;color:${INK}">${escapeHtml(item.name)}</p>
                  <p style="margin:6px 0 0;font-size:13px;line-height:20px;color:${MUTED}">Số lượng: <strong style="color:${INK}">${quantity}</strong></p>
                  ${item.note ? `<p style="margin:2px 0 0;font-size:13px;line-height:20px;color:${MUTED}">Lý do: <strong style="color:${INK}">${escapeHtml(item.note)}</strong></p>` : ""}
                  <p style="margin:8px 0 0;font-size:14px;line-height:20px;font-weight:700;color:${INK}">${escapeHtml(price)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>`;
      })
      .join("")}
  </table>`;
}

/** Mục 4: số tiền hoàn dự kiến + giải thích. */
function refundBlock(amount: number, note: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0">
    <tr>
      <td style="padding:16px 18px;background:${CREAM};border:1px solid ${SAND};border-radius:12px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
          <tr>
            <td style="font-size:13px;line-height:20px;color:${MUTED}">Số tiền hoàn dự kiến</td>
            <td style="font-size:18px;line-height:24px;font-weight:700;text-align:right;color:${INK}">${escapeHtml(formatVnd(amount))}</td>
          </tr>
        </table>
        <p style="margin:10px 0 0;font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(note)}</p>
      </td>
    </tr>
  </table>`;
}

function infoBox(title: string, inner: string): string {
  return `<div style="margin:16px 0;padding:14px 18px;background:${CREAM};border:1px solid ${SAND};border-radius:12px">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">${escapeHtml(title)}</p>
    ${inner}
  </div>`;
}

/** Bảng dòng tiền — nằm trong vùng nội dung đã có padding nên không dính lề. */
function summaryTable(rows: string[]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 16px">
    ${rows.join("")}
  </table>`;
}

/**
 * Danh sách món: LUÔN có tên, số lượng, loại sự cố (nếu có) và giá thuê cho
 * TỪNG dòng — kể cả phụ kiện / món đi kèm (giá 0 hiện "Miễn phí").
 *
 * Dùng BẢNG thay vì flexbox: Outlook/Gmail cũ không hỗ trợ `display:flex`.
 * `alt` để TRỐNG: tên món đã có dòng riêng ngay cạnh ảnh, nếu client chặn ảnh
 * thì không bị lặp lại tên.
 */
function itemList(items: IncidentEmailItem[]): string {
  if (items.length === 0) {
    return `<p style="margin:0 0 12px;font-size:14px;color:${MUTED}">Không có món nào.</p>`;
  }
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:4px 0 12px">
    ${items
      .map((item) => {
        const image = safeImageUrl(item.imageUrl);
        const quantity = Math.max(1, Number(item.quantity ?? 1));
        const meta = [`SL ${quantity}`, item.note ? `Sự cố: ${item.note}` : null]
          .filter(Boolean)
          .join(" · ");
        const price =
          typeof item.price === "number"
            ? `<p style="margin:6px 0 0;font-size:13px;color:${INK}"><strong>${
                item.price > 0 ? formatVnd(item.price) : "Miễn phí"
              }</strong></p>`
            : "";
        const cell = image
          ? `<img src="${escapeHtml(image)}" alt="" width="64" height="80" style="display:block;width:64px;height:80px;object-fit:cover;border-radius:8px;border:1px solid ${SAND}" />`
          : `<div style="width:64px;height:80px;border-radius:8px;background:${CREAM};border:1px solid ${SAND}"></div>`;
        return `<tr>
          <td style="width:64px;padding:10px 12px 10px 0;border-bottom:1px solid ${SAND};vertical-align:middle">${cell}</td>
          <td style="padding:10px 0;border-bottom:1px solid ${SAND};vertical-align:middle">
            <p style="margin:0;font-size:15px;font-weight:700;color:${INK}">${escapeHtml(item.name)}</p>
            <p style="margin:4px 0 0;font-size:13px;color:${MUTED}">${escapeHtml(meta)}</p>
            ${price}
          </td>
        </tr>`;
      })
      .join("")}
  </table>`;
}

function ctaButton(url: string, label: string): string {
  const safe = safeHttpUrl(url);
  if (!safe) return "";
  return `<div style="padding:8px 0 4px;text-align:center">
    <a href="${escapeHtml(safe)}" style="display:inline-block;background:${VIOLET};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:12px">${escapeHtml(label)}</a>
  </div>`;
}

const pStyle = `margin:0 0 10px;font-size:14px;line-height:22px`;

function row(label: string, value: string): string {
  return `<tr><td style="padding:10px 0;border-bottom:1px solid ${SAND};font-size:14px;color:${MUTED}">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid ${SAND};font-size:14px;font-weight:700;text-align:right;color:${INK}">${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Ảnh trong email phải tải được từ hộp thư của khách. URL nội bộ (localhost,
 * 127.0.0.1, dải private) không phân giải được ngoài máy dev → bỏ ảnh, dùng ô
 * placeholder. Vài dòng `garment_images` cũ còn lưu `http://localhost:3000/...`
 * chính là nguyên nhân "ảnh không hiện" trong mục "Các món trong đơn".
 */
const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|::1)/i;
const PRIVATE_172_PATTERN = /^172\.(1[6-9]|2\d|3[01])\./;

function safeImageUrl(value?: string | null): string | null {
  if (!value) return null;
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  try {
    const host = new URL(safe).hostname;
    if (PRIVATE_HOST_PATTERN.test(host) || PRIVATE_172_PATTERN.test(host)) return null;
    if (!host.includes(".") && host !== "localhost") return null;
  } catch {
    return null;
  }
  return safe;
}

function formatVnd(value: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(value))}đ`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Thuê trong ngày → một mốc ngày; nhiều ngày → "bắt đầu – kết thúc". */
function formatRentalRange(start: Date | string, end: Date | string): string {
  const from = formatDate(start);
  const to = formatDate(end);
  return from === to ? from : `${from} – ${to}`;
}

/** "Đang bảo trì" → "đang bảo trì" để ghép vào giữa câu. */
function lowerFirst(value: string): string {
  const text = value.trim();
  if (!text) return text;
  return text.charAt(0).toLocaleLowerCase("vi-VN") + text.slice(1);
}

function formatDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}