-- ============================================================================
-- 020_loyalty_points.sql
-- Hệ thống Loyalty / Tích Điểm Khách Hàng & Hạng Thành Viên (Basic / Plus / Premium)
-- ============================================================================

-- 1. Enum hạng thành viên: basic -> plus -> premium
DO $$ BEGIN
  CREATE TYPE "loyalty_tier" AS ENUM ('basic', 'plus', 'premium');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Thêm cột tier + tổng điểm vào user_accounts
ALTER TABLE "user_accounts"
  ADD COLUMN IF NOT EXISTS "loyalty_tier"              "loyalty_tier" NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS "loyalty_points"            INTEGER NOT NULL DEFAULT 0 CHECK ("loyalty_points" >= 0),
  ADD COLUMN IF NOT EXISTS "loyalty_points_lifetime"   INTEGER NOT NULL DEFAULT 0 CHECK ("loyalty_points_lifetime" >= 0);

CREATE INDEX IF NOT EXISTS "user_accounts_loyalty_tier_idx"
  ON "user_accounts" ("loyalty_tier");

-- 3. Bảng lịch sử điểm (immutable ledger)
CREATE TABLE IF NOT EXISTS "loyalty_point_logs" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id"   UUID NOT NULL REFERENCES "user_accounts"("id") ON DELETE CASCADE,
  "booking_id"    UUID REFERENCES "bookings"("id") ON DELETE SET NULL,
  "delta"         INTEGER NOT NULL,                -- dương: tích, âm: đổi
  "reason"        TEXT NOT NULL,                   -- e.g. 'earn_rental', 'redeem_voucher'
  "meta"          JSONB NOT NULL DEFAULT '{}',     -- { voucherId?, bookingCode?, rentalTotal? }
  "balance_after" INTEGER NOT NULL CHECK ("balance_after" >= 0),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "loyalty_point_logs_customer_id_idx"
  ON "loyalty_point_logs" ("customer_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "loyalty_point_logs_booking_id_idx"
  ON "loyalty_point_logs" ("booking_id");

-- 4. Bảng quy tắc đổi điểm lấy voucher (admin có thể cấu hình)
CREATE TABLE IF NOT EXISTS "loyalty_redemption_rules" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "points_required"       INTEGER NOT NULL CHECK ("points_required" > 0),
  "voucher_name"          TEXT NOT NULL,
  "discount_type"         "voucher_discount_type" NOT NULL,
  "discount_value"        DECIMAL(12,2) NOT NULL,
  "max_discount_amount"   DECIMAL(12,2),
  "min_order_value"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "voucher_validity_days" INTEGER NOT NULL DEFAULT 30,
  "is_active"             BOOLEAN NOT NULL DEFAULT true,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- 5. Seed dữ liệu mẫu cho rules đổi điểm
INSERT INTO "loyalty_redemption_rules"
  ("points_required", "voucher_name", "discount_type", "discount_value", "max_discount_amount", "min_order_value", "voucher_validity_days")
VALUES
  (500,  'Giảm 50.000đ (Đổi 500 điểm)',   'fixed',      50000,  NULL,   100000, 30),
  (1000, 'Giảm 120.000đ (Đổi 1.000 điểm)', 'fixed',      120000, NULL,   200000, 45),
  (200,  'Giảm 5% (Đổi 200 điểm)',         'percentage', 5,      50000,  0,      30)
ON CONFLICT DO NOTHING;
