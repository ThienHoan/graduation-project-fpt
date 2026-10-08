"use client";

import { useState, useEffect, useRef } from "react";
import { createReview, updateReview, getMyReviews, ReviewResponse } from "@/lib/api";
import { uploadFile } from "@/lib/upload";

type ReviewModalProps = {
  bookingId?: string;
  garmentId: string;
  garmentName: string;
  onClose: () => void;
  onSuccess: () => void;
};

export function ReviewModal({ bookingId, garmentId, garmentName, onClose, onSuccess }: ReviewModalProps) {
  const [existingReview, setExistingReview] = useState<ReviewResponse | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  
  // Media state
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchReview() {
      try {
        const res = await getMyReviews();
        if (res.success && res.data) {
          // If bookingId is provided, find that specific review. Else, find the most recent review for this garment.
          const matchingReviews = res.data.filter(r => 
            (bookingId ? r.bookingId === bookingId : true) && r.garmentId === garmentId
          );
          
          if (matchingReviews.length > 0) {
            // Sort to get the most recent if there are multiple
            matchingReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const review = matchingReviews[0];
            setExistingReview(review);
            setRating(review.rating);
            setComment(review.comment || "");
            setImages(review.images || []);
            setVideo(review.video || null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch review", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchReview();
  }, [bookingId, garmentId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    e.target.value = ''; // reset input
    
    // Check file type
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    
    if (!isVideo && !isImage) {
      setError("Chỉ hỗ trợ tải lên hình ảnh hoặc video.");
      return;
    }
    
    // Limits
    if (isVideo && video) {
      setError("Chỉ được tải lên tối đa 1 video.");
      return;
    }
    if (isImage && images.length >= 3) {
      setError("Chỉ được tải lên tối đa 3 hình ảnh.");
      return;
    }
    
    // 10MB limit for video
    if (isVideo && file.size > 10 * 1024 * 1024) {
      setError("Dung lượng video không được vượt quá 10MB.");
      return;
    }
    
    // 5MB limit for image
    if (isImage && file.size > 5 * 1024 * 1024) {
      setError("Dung lượng hình ảnh không được vượt quá 5MB.");
      return;
    }

    setIsUploading(true);
    setError(null);
    
    try {
      const url = await uploadFile(file, "reviews");
      if (isVideo) {
        setVideo(url);
      } else {
        setImages(prev => [...prev, url]);
      }
    } catch (err) {
      console.error("Upload error", err);
      setError("Lỗi kết nối khi tải file.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveVideo = () => {
    setVideo(null);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Validate garmentId is a proper UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(garmentId)) {
      setError("Không thể xác định sản phẩm. Vui lòng thử lại.");
      setIsSubmitting(false);
      return;
    }

    let res;
    if (existingReview) {
      if (existingReview.isLocked) {
        setError("Đánh giá này đã bị khóa vĩnh viễn và không thể chỉnh sửa.");
        setIsSubmitting(false);
        return;
      }
      res = await updateReview(existingReview.id, {
        rating,
        comment: comment.trim() || undefined,
        images,
        video: video || undefined,
      });
    } else {
      res = await createReview({
        bookingId,
        garmentId,
        rating,
        comment: comment.trim() || undefined,
        images,
        video: video || undefined,
      });
    }

    setIsSubmitting(false);

    if (res.success) {
      onSuccess();
      onClose();
    } else {
      setError(res.message || "Không thể lưu đánh giá. Vui lòng thử lại.");
    }
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl lg:p-8 text-center">
          <p>Đang tải...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl lg:p-8 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="font-display text-3xl text-ink">Đánh giá sản phẩm</h2>
            <p className="mt-2 text-sm text-stone-500">{garmentName}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-stone-100 transition"
          >
            <span className="material-symbols-outlined text-[20px] text-stone-500">close</span>
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {existingReview?.isLocked && (
          <div className="mb-6 rounded-lg bg-red-100 p-4 text-sm text-red-700 font-semibold border border-red-200">
            Đánh giá này đã bị khóa vĩnh viễn do vi phạm tiêu chuẩn cộng đồng nhiều lần. Bạn không thể chỉnh sửa nữa.
          </div>
        )}

        {existingReview?.status === 'hidden' && !existingReview.isLocked && (
          <div className="mb-6 rounded-lg bg-orange-50 p-4 text-sm text-orange-700 border border-orange-200">
            <p className="font-semibold mb-1">Đánh giá của bạn đã bị ẩn do vi phạm tiêu chuẩn.</p>
            <p>Bạn có thể chỉnh sửa và gửi lại (còn {3 - (existingReview.editCount || 0)} lần). Nếu vi phạm quá 3 lần, đánh giá sẽ bị khóa vĩnh viễn.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <fieldset disabled={existingReview?.isLocked} className="space-y-6">
            <div>
              <label className="mb-3 block text-sm font-semibold uppercase tracking-wider text-ink">
                Mức độ hài lòng
              </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110 focus:outline-none"
                >
                  <span
                    className={`material-symbols-outlined text-4xl ${
                      star <= rating ? "text-yellow-400 [font-variation-settings:'FILL'1]" : "text-stone-300"
                    }`}
                  >
                    star
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="comment" className="mb-2 block text-sm font-semibold uppercase tracking-wider text-ink">
              Nhận xét chi tiết (tùy chọn)
            </label>
            <textarea
              id="comment"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Chia sẻ cảm nhận của bạn về chất lượng trang phục..."
              className="w-full rounded-xl border border-sand bg-mist p-4 text-sm text-ink outline-none transition focus:border-lotus focus:bg-white focus:ring-1 focus:ring-lotus"
            />
          </div>

          {/* Upload Section */}
          <div>
            <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-ink">
              Hình ảnh & Video (Tùy chọn)
            </label>
            <p className="text-xs text-stone-500 mb-3">Tối đa 3 hình ảnh và 1 video (dưới 10MB).</p>
            
            <div className="flex flex-wrap gap-3">
              {/* Image previews */}
              {images.map((img, idx) => (
                <div key={idx} className="relative h-20 w-20 rounded-lg border border-sand overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="review" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(idx)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-black"
                  >
                    <span className="material-symbols-outlined text-[14px] block">close</span>
                  </button>
                </div>
              ))}
              
              {/* Video preview */}
              {video && (
                <div className="relative h-20 w-20 rounded-lg border border-sand overflow-hidden bg-black flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-[24px]">play_circle</span>
                  <button
                    type="button"
                    onClick={handleRemoveVideo}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-black"
                  >
                    <span className="material-symbols-outlined text-[14px] block">close</span>
                  </button>
                </div>
              )}
              
              {/* Add button */}
              {(images.length < 3 || !video) && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:bg-stone-100 hover:text-lotus transition disabled:opacity-50"
                >
                  {isUploading ? (
                    <span className="material-symbols-outlined text-[24px] animate-spin">sync</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[24px]">add_photo_alternate</span>
                      <span className="text-[10px] mt-1 font-semibold uppercase">Thêm</span>
                    </>
                  )}
                </button>
              )}
            </div>
            
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              onChange={handleFileUpload}
            />
          </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-sand">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-xl px-5 py-2.5 font-semibold text-stone-600 transition hover:bg-stone-100 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting || existingReview?.isLocked}
                className="flex items-center gap-2 rounded-xl bg-lotus px-6 py-2.5 font-semibold text-white shadow-md transition hover:bg-lotus-dark hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                    Đang lưu...
                  </>
                ) : (
                  <>Gửi đánh giá</>
                )}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
