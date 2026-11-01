-- ============================================================================
-- Chat CSKH assistant router
--
-- 1. Handoff nhẹ trên conversations: đủ để không gửi lặp câu tiếp nhận và
--    cho staff thấy lý do/mức ưu tiên. Không dùng để chặn FAQ/DB.
-- 2. faq_items: cấu hình FAQ (giá trị + template + trạng thái) cho router.
-- 3. chat_assistant_events: log/metrics nhẹ, KHÔNG chứa nội dung tin nhắn.
--
-- Migration này CHỈ là file SQL, chưa được apply lên database nào.
-- Khi được duyệt, áp dụng bằng:
--   npx prisma db execute --file prisma/migrations/20261028_chat_assistant_router/migration.sql
-- ============================================================================

-- 1) Handoff state ----------------------------------------------------------
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "handoff_state" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "handoff_reason" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "handoff_sensitive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "handoff_opened_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "handoff_ack_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "handoff_last_customer_msg_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "handoff_pending_count" INTEGER NOT NULL DEFAULT 0;

-- 2) FAQ config -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "faq_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "patterns" JSONB NOT NULL DEFAULT '[]',
    "answer_template" TEXT NOT NULL,
    "required_params" JSONB NOT NULL DEFAULT '[]',
    "values" JSONB NOT NULL DEFAULT '{}',
    "not_applicable" BOOLEAN NOT NULL DEFAULT false,
    "not_applicable_reply" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "faq_items_key_key" ON "faq_items"("key");
CREATE INDEX IF NOT EXISTS "faq_items_is_active_idx" ON "faq_items"("is_active");

-- 3) Structured log/metrics -------------------------------------------------
-- conversation_id cố ý không có FK: log phải sống độc lập với vòng đời hội thoại
-- và được dọn theo tuổi (CHAT_EVENTS_RETENTION_DAYS, mặc định 90 ngày).
CREATE TABLE IF NOT EXISTS "chat_assistant_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID,
    "route_type" TEXT NOT NULL,
    "intent" TEXT,
    "reason" TEXT,
    "handler" TEXT,
    "llm_called" BOOLEAN NOT NULL DEFAULT false,
    "handoff_reason" TEXT,
    "token_input" INTEGER,
    "token_output" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_assistant_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_assistant_events_created_at_idx" ON "chat_assistant_events"("created_at");
CREATE INDEX IF NOT EXISTS "chat_assistant_events_conversation_id_idx" ON "chat_assistant_events"("conversation_id");
CREATE INDEX IF NOT EXISTS "chat_assistant_events_route_type_idx" ON "chat_assistant_events"("route_type");
