-- ============================================================================
-- Manager support session:
-- Cho phép manager_owner nhắn khách trong hội thoại đã resolved của staff khác
-- mà không đổi status/staff_id. Các field dưới đây thuộc phiên hỗ trợ tạm thời.
-- ============================================================================

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "manager_support_by" UUID,
  ADD COLUMN IF NOT EXISTS "manager_support_state" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "manager_support_started_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "manager_support_last_read_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "manager_support_expires_at" TIMESTAMPTZ(6);
