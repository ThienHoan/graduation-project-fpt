-- ============================================================================
-- Booking accessory inspection: thêm trạng thái 'lost' (mất, đền theo giá trị).
-- ============================================================================

ALTER TABLE "booking_accessory_items" DROP CONSTRAINT IF EXISTS "booking_accessory_items_condition_status_chk";
ALTER TABLE "booking_accessory_items" ADD CONSTRAINT "booking_accessory_items_condition_status_chk"
  CHECK ("condition_status" IS NULL OR "condition_status" IN ('good', 'laundry', 'maintenance', 'damaged', 'lost'));
