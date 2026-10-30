-- ============================================================================
-- 019_customer_wishlist.sql
-- Bảng lưu trữ danh sách cổ phục yêu thích của khách hàng
-- ============================================================================

CREATE TABLE IF NOT EXISTS "customer_wishlists" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "user_accounts"("id") ON DELETE CASCADE,
  "garment_id" UUID NOT NULL REFERENCES "garments"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "uq_customer_wishlist_user_garment" UNIQUE ("user_id", "garment_id")
);

CREATE INDEX IF NOT EXISTS "idx_customer_wishlists_user_id" ON "customer_wishlists"("user_id");
CREATE INDEX IF NOT EXISTS "idx_customer_wishlists_garment_id" ON "customer_wishlists"("garment_id");
