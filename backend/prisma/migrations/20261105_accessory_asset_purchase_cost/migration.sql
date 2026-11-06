-- ============================================================================
-- 20261105_accessory_asset_purchase_cost
-- Định giá phụ kiện theo từng tài sản vật lý thay vì dùng chung 1 giá trị đền
-- trên bảng accessories.
--
-- 1. Thêm accessory_assets.purchase_cost (nullable — thiếu thì tính là 0).
-- 2. Backfill từ accessories.replacement_value cũ để không mất dữ liệu.
-- 3. Bỏ accessories.replacement_value.
--
-- An toàn khi chạy lại (IF NOT EXISTS / duplicate_object).
-- ============================================================================

ALTER TABLE "accessory_assets"
  ADD COLUMN IF NOT EXISTS "purchase_cost" DECIMAL(12,2);

-- Backfill: mỗi asset hiện có nhận giá trị đền cũ của phụ kiện cha.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accessories'
      AND column_name = 'replacement_value'
  ) THEN
    UPDATE "accessory_assets" AS aa
    SET "purchase_cost" = a."replacement_value"
    FROM "accessories" AS a
    WHERE aa."accessory_id" = a."id"
      AND aa."purchase_cost" IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE "accessory_assets"
    ADD CONSTRAINT "accessory_assets_purchase_cost_chk"
    CHECK ("purchase_cost" IS NULL OR "purchase_cost" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "accessories"
  DROP COLUMN IF EXISTS "replacement_value";
