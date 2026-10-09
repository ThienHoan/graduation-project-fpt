-- ============================================================================
-- Task 1: Giá tự động theo ngày đặc biệt (price_rules)
-- Task 2: Voucher & khuyến mãi (vouchers, voucher_usages)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "price_rule_type" AS ENUM ('tet','holiday','double_sale','weekend','peak_season','store_program');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "voucher_discount_type" AS ENUM ('percentage','fixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "price_rules" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"             TEXT NOT NULL,
  "rule_type"        "price_rule_type" NOT NULL,
  "start_date"       DATE,
  "end_date"         DATE,
  "recurring_yearly" BOOLEAN NOT NULL DEFAULT false,
  "days_of_week"     INTEGER[] NOT NULL DEFAULT '{}',
  "percentage"       DECIMAL(5,2),
  "fixed_amount"     DECIMAL(12,2),
  "priority"         INTEGER NOT NULL DEFAULT 0,
  "category_ids"     UUID[] NOT NULL DEFAULT '{}',
  "garment_ids"      UUID[] NOT NULL DEFAULT '{}',
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "note"             TEXT,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "price_rules_date_range_chk" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date" OR "recurring_yearly"),
  CONSTRAINT "price_rules_percentage_chk" CHECK ("percentage" IS NULL OR ("percentage" >= -100 AND "percentage" <= 500))
);
CREATE INDEX IF NOT EXISTS "price_rules_is_active_rule_type_idx" ON "price_rules" ("is_active", "rule_type");

CREATE TABLE IF NOT EXISTS "vouchers" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"                TEXT NOT NULL UNIQUE,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "discount_type"       "voucher_discount_type" NOT NULL,
  "discount_value"      DECIMAL(12,2) NOT NULL,
  "max_discount_amount" DECIMAL(12,2),
  "min_order_value"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  "usage_limit"         INTEGER,
  "used_count"          INTEGER NOT NULL DEFAULT 0,
  "per_user_limit"      INTEGER DEFAULT 1,
  "start_at"            TIMESTAMPTZ(6) NOT NULL,
  "end_at"              TIMESTAMPTZ(6) NOT NULL,
  "category_ids"        UUID[] NOT NULL DEFAULT '{}',
  "garment_ids"         UUID[] NOT NULL DEFAULT '{}',
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "vouchers_value_chk" CHECK ("discount_value" > 0 AND ("discount_type" <> 'percentage' OR "discount_value" <= 100)),
  CONSTRAINT "vouchers_time_chk" CHECK ("start_at" < "end_at"),
  CONSTRAINT "vouchers_used_count_chk" CHECK ("used_count" >= 0 AND ("usage_limit" IS NULL OR "used_count" <= "usage_limit"))
);
CREATE INDEX IF NOT EXISTS "vouchers_is_active_start_at_end_at_idx" ON "vouchers" ("is_active", "start_at", "end_at");

CREATE TABLE IF NOT EXISTS "voucher_usages" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "voucher_id"      UUID NOT NULL REFERENCES "vouchers"("id") ON DELETE CASCADE,
  "customer_id"     UUID NOT NULL REFERENCES "user_accounts"("id") ON DELETE CASCADE,
  "booking_id"      UUID NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE CASCADE,
  "discount_amount" DECIMAL(12,2) NOT NULL,
  "is_released"     BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "voucher_usages_voucher_id_customer_id_idx" ON "voucher_usages" ("voucher_id", "customer_id");

-- Booking: lưu tạm tính, giảm giá voucher
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "voucher_id" UUID REFERENCES "vouchers"("id") ON DELETE SET NULL;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "voucher_code" TEXT;
UPDATE "bookings" SET "subtotal" = "rental_total" WHERE "subtotal" = 0;

-- Booking item: không sửa giá gốc, lưu basePrice / discountPrice / appliedPriceRule
ALTER TABLE "booking_items" ADD COLUMN IF NOT EXISTS "base_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "booking_items" ADD COLUMN IF NOT EXISTS "discount_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "booking_items" ADD COLUMN IF NOT EXISTS "applied_price_rule" JSONB;
UPDATE "booking_items" SET "base_price" = "daily_price", "discount_price" = "daily_price" WHERE "base_price" = 0;

-- Rule mẫu (TẮT sẵn — chủ cửa hàng bật trong trang quản lý)
INSERT INTO "price_rules" ("name","rule_type","start_date","end_date","recurring_yearly","days_of_week","percentage","priority","is_active","note") VALUES
  ('Tết Nguyên Đán 2027','tet','2027-01-30','2027-02-14',false,'{}',30,100,false,'Cao điểm thuê áo dài Tết'),
  ('Lễ 30/4 - 1/5','holiday','2026-04-28','2026-05-03',true,'{}',15,80,false,NULL),
  ('Quốc khánh 2/9','holiday','2026-08-30','2026-09-03',true,'{}',15,80,false,NULL),
  ('Sale đôi 9/9','double_sale','2026-09-09','2026-09-09',true,'{}',-15,60,false,NULL),
  ('Sale đôi 10/10','double_sale','2026-10-10','2026-10-10',true,'{}',-15,60,false,NULL),
  ('Sale đôi 11/11','double_sale','2026-11-11','2026-11-11',true,'{}',-15,60,false,NULL),
  ('Sale đôi 12/12','double_sale','2026-12-12','2026-12-12',true,'{}',-15,60,false,NULL),
  ('Cuối tuần','weekend',NULL,NULL,false,'{0,6}',10,40,false,'Thứ 7 & Chủ nhật'),
  ('Mùa cưới / tốt nghiệp','peak_season','2026-11-15','2027-01-15',false,'{}',10,50,false,NULL)
ON CONFLICT DO NOTHING;
