-- ============================================================================
-- 025_loyalty_tier_expiration.sql
-- Thêm cơ chế thời hạn 12 tháng cho Hạng Thành Viên và Điểm Thưởng Loyalty
-- ============================================================================

-- 1. Thêm cột ngày hết hạn và ngày bắt đầu chu kỳ hạng thành viên vào user_accounts
ALTER TABLE "user_accounts"
  ADD COLUMN IF NOT EXISTS "loyalty_tier_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "loyalty_tier_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

-- Index phục vụ cron quét tài khoản hết hạn nhanh chóng
CREATE INDEX IF NOT EXISTS "user_accounts_loyalty_tier_expires_idx"
  ON "user_accounts" ("loyalty_tier_expires_at")
  WHERE "loyalty_tier" != 'basic';

-- 2. Thêm cột hạn dùng điểm vào bảng lịch sử loyalty_point_logs
ALTER TABLE "loyalty_point_logs"
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "loyalty_point_logs_expires_at_idx"
  ON "loyalty_point_logs" ("expires_at")
  WHERE "delta" > 0;

-- 3. Khởi tạo hạn 12 tháng cho các tài khoản hiện tại đang ở hạng Plus hoặc Premium
UPDATE "user_accounts"
SET
  "loyalty_tier_expires_at" = now() + INTERVAL '12 months',
  "loyalty_tier_updated_at" = now()
WHERE "loyalty_tier" IN ('plus', 'premium')
  AND "loyalty_tier_expires_at" IS NULL;

-- 4. Khởi tạo hạn 12 tháng cho các điểm đã tích trước đây
UPDATE "loyalty_point_logs"
SET "expires_at" = "created_at" + INTERVAL '12 months'
WHERE "delta" > 0
  AND "expires_at" IS NULL;

