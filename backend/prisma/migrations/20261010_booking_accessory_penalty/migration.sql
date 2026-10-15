-- ============================================================================
-- Booking accessory inspection: phạt riêng từng dòng phụ kiện (hư/mất).
-- ============================================================================

ALTER TABLE "booking_accessory_items" ADD COLUMN IF NOT EXISTS "penalty_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "booking_accessory_items" ADD CONSTRAINT "booking_accessory_items_penalty_amount_chk"
    CHECK ("penalty_amount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
