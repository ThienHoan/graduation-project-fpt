-- ============================================================================
-- Booking accessory items: phụ kiện khách chọn thuê kèm theo từng món.
-- Snapshot giá tại lúc đặt: unit_price (extra_price/ngày) × quantity × số ngày.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "booking_accessory_items" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"         UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "booking_item_id"    UUID NOT NULL REFERENCES "booking_items"("id") ON DELETE CASCADE,
  "accessory_id"       UUID NOT NULL REFERENCES "accessories"("id") ON DELETE RESTRICT,
  "accessory_asset_id" UUID REFERENCES "accessory_assets"("id") ON DELETE SET NULL,
  "quantity"           INTEGER NOT NULL DEFAULT 1,
  "unit_price"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  "is_included"        BOOLEAN NOT NULL DEFAULT true,
  "rental_total"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "booking_accessory_items_quantity_chk" CHECK ("quantity" > 0),
  CONSTRAINT "booking_accessory_items_unit_price_chk" CHECK ("unit_price" >= 0),
  CONSTRAINT "booking_accessory_items_rental_total_chk" CHECK ("rental_total" >= 0)
);
CREATE INDEX IF NOT EXISTS "booking_accessory_items_booking_id_idx" ON "booking_accessory_items" ("booking_id");
CREATE INDEX IF NOT EXISTS "booking_accessory_items_booking_item_id_idx" ON "booking_accessory_items" ("booking_item_id");
