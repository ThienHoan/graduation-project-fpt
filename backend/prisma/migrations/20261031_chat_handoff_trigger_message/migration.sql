-- ============================================================================
-- Chat CSKH: ghi lại tin nhắn đã kích hoạt handoff.
--
-- Vì sao cần: badge "Khiếu nại" một mình không cho staff biết phải đọc tin nào.
-- Cột này cho phép UI chèn divider "Bot chuyển nhân viên" đúng vị trí trong
-- mạch hội thoại, thay vì đoán theo handoff_opened_at (lệch khi khách gửi
-- nhiều tin liên tiếp trong cùng một giây).
--
-- Cột nullable, không FK (tin nhắn có thể bị xóa mềm), add-only nên an toàn
-- chạy lại nhiều lần.
--
-- Áp dụng bằng:
--   npx prisma db execute --file prisma/migrations/20261031_chat_handoff_trigger_message/migration.sql
-- ============================================================================

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "handoff_trigger_message_id" UUID;