-- Gán garment_size_id cho các asset đang NULL, trong trường hợp garment
-- chỉ có đúng 1 size active (suy ra duy nhất, an toàn).
-- Chạy sau khi API POST /assets đã tự gán size cho asset mới.

UPDATE public.garment_assets ga
SET garment_size_id = gs.id,
    updated_at = now()
FROM public.garment_sizes gs
WHERE ga.garment_size_id IS NULL
  AND gs.garment_id = ga.garment_id
  AND gs.is_active = true
  AND (
    SELECT COUNT(*)
    FROM public.garment_sizes gs2
    WHERE gs2.garment_id = ga.garment_id
      AND gs2.is_active = true
  ) = 1;

-- Kiểm tra còn sót (garment nhiều size cần gán tay qua UI tạo asset):
-- SELECT ga.asset_code, g.name
-- FROM public.garment_assets ga
-- JOIN public.garments g ON g.id = ga.garment_id
-- WHERE ga.garment_size_id IS NULL;
