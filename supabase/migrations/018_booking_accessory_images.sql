-- ============================================================================
-- Booking accessory inspection: ảnh bằng chứng hư hỏng staff tải lúc kiểm tra.
-- ============================================================================

ALTER TABLE "booking_accessory_items" ADD COLUMN IF NOT EXISTS "condition_images" TEXT[] NOT NULL DEFAULT '{}';
