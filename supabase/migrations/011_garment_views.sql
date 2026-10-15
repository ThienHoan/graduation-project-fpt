-- Task 3: Lượt xem sản phẩm phục vụ thống kê sản phẩm HOT / ít được thuê
CREATE TABLE IF NOT EXISTS "garment_views" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "garment_id"  UUID NOT NULL REFERENCES "garments"("id") ON DELETE CASCADE,
  "visitor_key" TEXT NOT NULL,
  "viewer_id"   UUID,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "garment_views_garment_id_created_at_idx" ON "garment_views" ("garment_id", "created_at");
CREATE INDEX IF NOT EXISTS "garment_views_garment_id_visitor_key_created_at_idx" ON "garment_views" ("garment_id", "visitor_key", "created_at");
