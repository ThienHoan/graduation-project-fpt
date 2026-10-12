-- ============================================================================
-- Booking accessory inspection: kết quả kiểm tra phụ kiện khi khách trả đồ.
-- ============================================================================

ALTER TABLE "booking_accessory_items" ADD COLUMN IF NOT EXISTS "condition_status" TEXT;
ALTER TABLE "booking_accessory_items" ADD COLUMN IF NOT EXISTS "condition_note" TEXT;
ALTER TABLE "booking_accessory_items" ADD COLUMN IF NOT EXISTS "inspected_at" TIMESTAMPTZ(6);
ALTER TABLE "booking_accessory_items" ADD COLUMN IF NOT EXISTS "inspected_by" UUID;
DO $$ BEGIN
  ALTER TABLE "booking_accessory_items" ADD CONSTRAINT "booking_accessory_items_condition_status_chk"
    CHECK ("condition_status" IS NULL OR "condition_status" IN ('good', 'laundry', 'maintenance', 'damaged'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
