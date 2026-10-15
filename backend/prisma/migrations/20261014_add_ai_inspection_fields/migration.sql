-- ============================================================================
-- AI inspection comparison fields:
-- 1. InspectionSession: Lưu kết quả phân tích so sánh AI và thời gian so sánh
-- 2. InspectionPhoto: Phân loại ảnh trước (handover/before) / sau (return/after) và AI analysis
-- ============================================================================

ALTER TABLE "inspection_sessions"
  ADD COLUMN IF NOT EXISTS "ai_comparison_result" JSONB,
  ADD COLUMN IF NOT EXISTS "ai_compared_at" TIMESTAMPTZ(6);

ALTER TABLE "inspection_photos"
  ADD COLUMN IF NOT EXISTS "photo_type" VARCHAR(30) NOT NULL DEFAULT 'after',
  ADD COLUMN IF NOT EXISTS "ai_analysis" JSONB;
