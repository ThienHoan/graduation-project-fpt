/**
 * `linkUrl` do server sinh cho thông báo. Server đã lọc nhưng FE kiểm tra lại
 * trước khi render `Link` để phòng open-redirect/XSS nếu dữ liệu bị sửa.
 *
 * Chỉ nhận đường dẫn tương đối "gọn":
 * - bắt đầu bằng "/" (không phải URL tuyệt đối);
 * - không có khoảng trắng đầu/cuối hay ký tự điều khiển (có thể che URL thật);
 * - không phải protocol-relative ("//host") hay backslash trick ("/\host").
 */
export function isSafeLink(linkUrl: string | null | undefined): linkUrl is string {
  if (typeof linkUrl !== "string") return false;
  if (linkUrl !== linkUrl.trim()) return false;
  if (/[\u0000-\u001F\u007F]/.test(linkUrl)) return false;
  if (!linkUrl.startsWith("/")) return false;
  if (linkUrl.startsWith("//") || linkUrl.startsWith("/\\")) return false;
  return true;
}