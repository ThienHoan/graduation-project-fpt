import type { StoreContactInfo } from "./email-templates.types";

/**
 * Brand Constants for Cổ Phục Hoàng Thành AI.
 * Derived from Official Brand Guidelines (frontend/public/brand/BRAND_GUIDELINES.md).
 */
export const BRAND_NAME = "Cổ Phục Hoàng Thành";
export const BRAND_TAGLINE = "Hệ thống Cho thuê Cổ phục Triều Nguyễn & Thử đồ AI";
export const DEFAULT_STORE_ADDRESS =
  "Đại học FPT Đà Nẵng, Khu đô thị FPT City, Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng";
export const DEFAULT_STORE_PHONE = "0236 730 0999";
export const DEFAULT_BUSINESS_HOURS = "08:00 - 20:00 (Hằng ngày)";
export const DEFAULT_SUPPORT_EMAIL = "cophuctruyenthong@gmail.com";
export const DEFAULT_WEBSITE_URL = "https://cophuc.vn";
export const DEFAULT_CUSTOMER_DASHBOARD_URL = "https://cophuc.vn/dashboard/customer";

export const BRAND_COLORS = {
  primaryGold: "#D4AF37", // Hoàng Kim (Imperial Gold)
  primaryGoldDark: "#B8860B",
  accentCrimson: "#881337", // Chu Sa / Đỏ Huyết Dụ (Royal Crimson)
  accentCrimsonDark: "#701A24",
  bgParchment: "#FAF8F5", // Giấy Dó Hoàng Cung (Parchment White)
  bgCard: "#FFFFFF",
  textObsidian: "#1C1917", // Trầm Hương Đen (Imperial Obsidian)
  textMuted: "#57534E",
  borderGold: "#E8DFD1",
  successGreen: "#15803D",
  warningAmber: "#B45309",
};

/**
 * Escapes special HTML characters to prevent XSS and HTML injection.
 */
export function escapeHtml(str: unknown): string {
  if (str == null) return "";
  const s = String(str);
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validates URLs strictly. Only permits absolute http/https URLs or safe relative paths.
 */
export function sanitizeUrl(url?: string | null, fallback = DEFAULT_CUSTOMER_DASHBOARD_URL): string {
  if (!url || typeof url !== "string") return fallback;
  const trimmed = url.trim();
  if (/^(?:https?:\/\/|\/)[^\s<>"']+$/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

/**
 * Formats a number into Vietnamese Dong currency string (e.g. 50.000 đ).
 */
export function formatVndCurrency(amount?: number | null): string {
  const num = typeof amount === "number" && !Number.isNaN(amount) ? amount : 0;
  return new Intl.NumberFormat("vi-VN").format(num) + " đ";
}

/**
 * Formats date into DD/MM/YYYY.
 */
export function formatDateDisplay(dateInput?: Date | string | null): string {
  if (!dateInput) return "hôm nay";
  try {
    const str = typeof dateInput === "string" ? dateInput.slice(0, 10) : dateInput.toISOString().slice(0, 10);
    const [y, m, d] = str.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
    return str;
  } catch {
    return "hôm nay";
  }
}

/**
 * Renders an accessible, table-based Call-To-Action (CTA) button compatible with all email clients.
 */
export function renderCtaButton(label: string, url: string): string {
  const safeUrl = escapeHtml(sanitizeUrl(url));
  const safeLabel = escapeHtml(label);

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto; text-align: center;">
      <tr>
        <td align="center" style="border-radius: 8px; background: linear-gradient(135deg, ${BRAND_COLORS.accentCrimson} 0%, ${BRAND_COLORS.accentCrimsonDark} 100%);">
          <a href="${safeUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: 700; color: #FFFFFF; text-decoration: none; border-radius: 8px; letter-spacing: 0.05em; text-transform: uppercase; border: 1px solid ${BRAND_COLORS.primaryGold};">
            ${safeLabel}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Renders a structured booking detail table with alternating rows.
 */
export function renderInfoCard(
  cardTitle: string,
  items: Array<{ label: string; value: string; highlight?: boolean }>,
): string {
  const rows = items
    .map(
      (item, idx) => `
      <tr style="background-color: ${idx % 2 === 0 ? "#FAF8F5" : "#FFFFFF"};">
        <td style="padding: 10px 14px; font-size: 13px; color: ${BRAND_COLORS.textMuted}; width: 38%; font-weight: 500; border-bottom: 1px solid ${BRAND_COLORS.borderGold}; vertical-align: middle;">
          ${escapeHtml(item.label)}
        </td>
        <td style="padding: 10px 14px; font-size: 13px; color: ${item.highlight ? BRAND_COLORS.accentCrimson : BRAND_COLORS.textObsidian}; font-weight: ${item.highlight ? "700" : "600"}; border-bottom: 1px solid ${BRAND_COLORS.borderGold}; vertical-align: middle;">
          ${escapeHtml(item.value)}
        </td>
      </tr>
    `,
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0 20px; border: 1px solid ${BRAND_COLORS.borderGold}; border-radius: 8px; overflow: hidden; background: #FFFFFF;">
      <tr>
        <td colspan="2" style="background: #F5EFEB; padding: 12px 14px; font-family: 'Times New Roman', Georgia, serif; font-size: 15px; font-weight: 700; color: ${BRAND_COLORS.accentCrimson}; border-bottom: 1px solid ${BRAND_COLORS.borderGold};">
          ${escapeHtml(cardTitle)}
        </td>
      </tr>
      ${rows}
    </table>
  `;
}

/**
 * Renders a highlighted notice box with custom border/background styling.
 */
export function renderNoticeBox(
  type: "warning" | "info" | "success" | "gold",
  title: string,
  contentHtml: string,
): string {
  let borderColor = BRAND_COLORS.borderGold;
  let bg = "#FBF9F6";
  let titleColor = BRAND_COLORS.accentCrimson;

  if (type === "warning") {
    borderColor = "#F59E0B";
    bg = "#FFFBEB";
    titleColor = "#B45309";
  } else if (type === "success") {
    borderColor = "#10B981";
    bg = "#ECFDF5";
    titleColor = "#047857";
  } else if (type === "gold") {
    borderColor = BRAND_COLORS.primaryGold;
    bg = "#FFFDF9";
    titleColor = BRAND_COLORS.accentCrimson;
  }

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0; border: 1px solid ${borderColor}; border-left: 4px solid ${borderColor}; border-radius: 6px; background: ${bg};">
      <tr>
        <td style="padding: 14px 16px;">
          <div style="font-size: 14px; font-weight: 700; color: ${titleColor}; margin-bottom: 6px;">
            ${escapeHtml(title)}
          </div>
          <div style="font-size: 13px; line-height: 1.6; color: ${BRAND_COLORS.textObsidian};">
            ${contentHtml}
          </div>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Base Email Wrapper providing the signature Royal Vietnamese layout.
 */
export function wrapBaseEmailHtml(options: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  storeInfo?: StoreContactInfo;
}): string {
  const storeAddress = options.storeInfo?.storeAddress?.trim() || DEFAULT_STORE_ADDRESS;
  const storePhone = options.storeInfo?.storePhone?.trim() || DEFAULT_STORE_PHONE;
  const businessHours = options.storeInfo?.businessHours?.trim() || DEFAULT_BUSINESS_HOURS;
  const supportEmail = options.storeInfo?.supportEmail?.trim() || DEFAULT_SUPPORT_EMAIL;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(options.title)} — ${BRAND_NAME}</title>
  ${
    options.preheader
      ? `<div style="display: none; max-height: 0px; overflow: hidden;">${escapeHtml(options.preheader)}</div>`
      : ""
  }
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND_COLORS.bgParchment}; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased; color: ${BRAND_COLORS.textObsidian};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${BRAND_COLORS.bgParchment}; padding: 32px 12px;">
    <tr>
      <td align="center">
        <!-- 600px Max Container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(28, 25, 23, 0.08); border: 1px solid ${BRAND_COLORS.borderGold};">

          <!-- 1. ROYAL HEADER -->
          <tr>
            <td style="background: linear-gradient(135deg, ${BRAND_COLORS.accentCrimsonDark} 0%, ${BRAND_COLORS.accentCrimson} 100%); padding: 32px 36px 24px; text-align: center;">
              <!-- Royal Monogram Emblem -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto 12px;">
                <tr>
                  <td style="width: 44px; height: 44px; border: 2px solid ${BRAND_COLORS.primaryGold}; border-radius: 50%; text-align: center; vertical-align: middle; background: rgba(212, 175, 55, 0.15);">
                    <span style="font-size: 20px; line-height: 44px; color: ${BRAND_COLORS.primaryGold};">&#9819;</span>
                  </td>
                </tr>
              </table>
              <div style="font-family: 'Times New Roman', Georgia, serif; font-size: 22px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #FFFFFF; margin-bottom: 4px;">
                ${BRAND_NAME}
              </div>
              <div style="font-size: 12px; color: #F3E8D0; letter-spacing: 0.04em;">
                ${BRAND_TAGLINE}
              </div>
            </td>
          </tr>

          <!-- 2. DECORATIVE IMPERIAL DIVIDER RIBBON -->
          <tr>
            <td style="padding: 0; height: 4px; background: linear-gradient(90deg, ${BRAND_COLORS.accentCrimson} 0%, ${BRAND_COLORS.primaryGold} 50%, ${BRAND_COLORS.accentCrimson} 100%);"></td>
          </tr>

          <!-- 3. MAIN EMAIL BODY CONTENT -->
          <tr>
            <td style="padding: 32px 36px 24px;">
              <h1 style="font-family: 'Times New Roman', Georgia, serif; font-size: 20px; font-weight: 700; color: ${BRAND_COLORS.accentCrimson}; margin: 0 0 10px; line-height: 1.35;">
                ${escapeHtml(options.title)}
              </h1>
              <div style="width: 48px; height: 3px; background: ${BRAND_COLORS.primaryGold}; border-radius: 2px; margin-bottom: 24px;"></div>

              <div style="font-size: 14px; line-height: 1.75; color: ${BRAND_COLORS.textObsidian};">
                ${options.bodyHtml}
              </div>
            </td>
          </tr>

          <!-- 4. SHOWROOM & ASSISTANCE BOX -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #FDFBF7; border: 1px solid ${BRAND_COLORS.borderGold}; border-radius: 8px; padding: 16px 20px;">
                <tr>
                  <td style="font-size: 13px; line-height: 1.65; color: ${BRAND_COLORS.textMuted};">
                    <strong style="color: ${BRAND_COLORS.accentCrimson};">&#127963; Địa chỉ Showroom:</strong> ${escapeHtml(storeAddress)}<br>
                    <strong style="color: ${BRAND_COLORS.accentCrimson};">&#128338; Giờ đón khách:</strong> ${escapeHtml(businessHours)} &nbsp;|&nbsp;
                    <strong style="color: ${BRAND_COLORS.accentCrimson};">&#9742; Hotline:</strong> <a href="tel:${escapeHtml(storePhone)}" style="color: ${BRAND_COLORS.accentCrimson}; text-decoration: none; font-weight: 600;">${escapeHtml(storePhone)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 5. ROYAL FOOTER -->
          <tr>
            <td style="background: ${BRAND_COLORS.textObsidian}; padding: 24px 36px; text-align: center; border-radius: 0 0 12px 12px;">
              <div style="font-family: 'Times New Roman', Georgia, serif; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${BRAND_COLORS.primaryGold}; margin-bottom: 8px;">
                ${BRAND_NAME}
              </div>
              <div style="font-size: 12px; color: #A8A29E; line-height: 1.6;">
                Hỗ trợ khách hàng: <a href="mailto:${escapeHtml(supportEmail)}" style="color: #D6D3D1; text-decoration: none;">${escapeHtml(supportEmail)}</a><br>
                Đà Nẵng, Việt Nam
              </div>
              <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #78716C; line-height: 1.5;">
                &copy; 2026 ${BRAND_NAME}. Thư thông báo tự động theo tiến trình đơn thuê cổ phục.<br>
                Quý khách vui lòng không trả lời trực tiếp email này.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Creates plain text fallback representation for any email.
 */
export function wrapPlainText(options: {
  title: string;
  bodyText: string;
  storeInfo?: StoreContactInfo;
}): string {
  const storeAddress = options.storeInfo?.storeAddress?.trim() || DEFAULT_STORE_ADDRESS;
  const storePhone = options.storeInfo?.storePhone?.trim() || DEFAULT_STORE_PHONE;
  const businessHours = options.storeInfo?.businessHours?.trim() || DEFAULT_BUSINESS_HOURS;
  const supportEmail = options.storeInfo?.supportEmail?.trim() || DEFAULT_SUPPORT_EMAIL;

  return [
    `=== ${BRAND_NAME.toUpperCase()} ===`,
    `${BRAND_TAGLINE}`,
    `----------------------------------------`,
    `${options.title.toUpperCase()}`,
    `----------------------------------------`,
    "",
    options.bodyText.trim(),
    "",
    `----------------------------------------`,
    `THÔNG TIN SHOWROOM:`,
    `- Địa chỉ: ${storeAddress}`,
    `- Giờ mở cửa: ${businessHours}`,
    `- Hotline hỗ trợ: ${storePhone}`,
    `- Email: ${supportEmail}`,
    `----------------------------------------`,
    `© 2026 ${BRAND_NAME}. Thư tự động từ hệ thống.`,
  ].join("\n");
}

