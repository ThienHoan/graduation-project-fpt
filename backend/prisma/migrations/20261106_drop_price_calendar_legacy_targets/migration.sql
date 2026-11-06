-- Bỏ các cột phạm vi cũ của price_calendar
--   - target_category_ids, target_occasions: không còn dùng
--   - garment_keywords: fallback legacy không còn dùng
-- Giữ lại: apply_all, target_garment_ids.

ALTER TABLE "price_calendar"
  DROP COLUMN IF EXISTS "target_category_ids",
  DROP COLUMN IF EXISTS "target_occasions",
  DROP COLUMN IF EXISTS "garment_keywords";
