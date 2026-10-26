/**
 * Nhận diện câu hỏi duyệt danh mục / hỏi mở rộng, ví dụ:
 * - "Ngoài áo dài shop còn có trang phục gì?"
 * - "Sản phẩm ngoài cổ phục"
 * - "Cổ phục còn mẫu nào khác?"
 * - "Shop có những loại nào?"
 */
const BROWSE_PATTERN =
  /(?:^|\s)(?:ngoài(?:\s+ra)?|khác|các\s+loại|những\s+loại|loại\s+nào|mẫu\s+nào|sản\s+phẩm\s+nào|có\s+gì|còn\s+gì|có\s+những\s+gì|thêm\s+gì|gì\s+khác)(?=\s|$|[.,!?;])/iu;

export function isBrowseQuestion(message: string): boolean {
  return BROWSE_PATTERN.test(message.toLowerCase());
}
