-- ============================================================================
-- 20261105_price_calendar_targets
-- Thay phạm vi áp dụng bằng từ khóa của "Lịch sự kiện" bằng lựa chọn có cấu trúc:
--   - apply_all: áp dụng tất cả sản phẩm
--   - target_category_ids: các danh mục được chọn
--   - target_occasions: các dịp được chọn (so khớp garments.occasion)
--   - target_garment_ids: các sản phẩm cụ thể được chọn
--
-- garment_keywords được giữ lại để tương thích dữ liệu cũ (legacy fallback).
-- An toàn khi chạy lại.
-- ============================================================================

ALTER TABLE "price_calendar"
  ADD COLUMN IF NOT EXISTS "apply_all" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "price_calendar"
  ADD COLUMN IF NOT EXISTS "target_category_ids" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "price_calendar"
  ADD COLUMN IF NOT EXISTS "target_occasions" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "price_calendar"
  ADD COLUMN IF NOT EXISTS "target_garment_ids" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill idempotent: sự kiện cũ có từ khóa thì không còn là "áp dụng toàn bộ".
-- Sự kiện cũ không có từ khóa giữ apply_all = true (đúng ý định ban đầu của UI).
UPDATE "price_calendar"
SET "apply_all" = false
WHERE COALESCE(array_length("garment_keywords", 1), 0) > 0
  AND "target_category_ids" = '{}'
  AND "target_occasions" = '{}'
  AND "target_garment_ids" = '{}'
  AND "apply_all" = true;
