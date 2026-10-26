-- ============================================================================
-- Tài khoản AI assistant dùng làm sender cho tin nhắn tự động trong chat.
-- Backend tham chiếu cứng id '00000000-0000-0000-0000-000000000000'
-- (xem AI_USER_ID trong backend/src/modules/chat/chat.service.ts).
-- Thiếu row này thì mọi INSERT vào messages sẽ vi phạm FK sender_id và
-- auto-reply thất bại âm thầm.
-- ============================================================================

INSERT INTO public.user_accounts (id, email, password_hash, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'ai@system',
  '!disabled-ai-account-no-login',
  'staff',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, user_id, full_name)
VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000000',
  'Trợ lý Cổ Phục AI'
)
ON CONFLICT DO NOTHING;
