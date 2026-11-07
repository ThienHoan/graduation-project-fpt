"use client";

import { useState } from "react";
import { ReviewResponse } from "@/lib/api";
import { RatingStars } from "./rating-stars";
import { BadgeCheck, MessageCircle, MoreVertical, Edit2, Trash2, X, Play } from "lucide-react";

export type ReviewItemCardProps = {
  review: ReviewResponse;
  currentUserId?: string;
  onEdit?: (review: ReviewResponse) => void;
  onDelete?: (review: ReviewResponse) => void;
  className?: string;
};

const FIT_LABELS: Record<string, { label: string; badgeClass: string }> = {
  true_to_size: {
    label: "Vừa vặn chuẩn size",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  tight: {
    label: "Hơi chật",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  loose: {
    label: "Hơi rộng",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
  },
};

export function ReviewItemCard({
  review,
  currentUserId,
  onEdit,
  onDelete,
  className = "",
}: ReviewItemCardProps) {
  const [selectedMedia, setSelectedMedia] = useState<string | null>(null);
  const [isVideoModal, setIsVideoModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isOwner = currentUserId && review.customerId === currentUserId;
  const canEdit = isOwner && !review.isLocked && (review.editCount ?? 0) < 3;
  const canDelete = isOwner;

  const authorName = review.customer?.profile?.fullName || review.customer?.email || "Khách hàng";
  const authorInitials = authorName.charAt(0).toUpperCase();

  const formattedDate = new Date(review.createdAt).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const fitInfo = review.fitFeedback ? FIT_LABELS[review.fitFeedback] : null;

  return (
    <div
      className={`bg-white border border-neutral-200/80 rounded-2xl p-5 shadow-2xs space-y-4 transition-all hover:border-neutral-300 ${className}`}
      data-testid={`review-card-${review.id}`}
    >
      {/* Header: Author info, rating, and actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-linear-to-br from-amber-500 to-amber-700 text-white font-bold flex items-center justify-center shrink-0 shadow-xs">
            {authorInitials}
          </div>

          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-bold text-neutral-900">{authorName}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <BadgeCheck className="w-3 h-3 text-emerald-600" />
                <span>Đã thuê trang phục</span>
              </span>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <RatingStars value={review.rating} size="sm" />
              <span className="text-neutral-300">•</span>
              <span className="text-xs text-neutral-400">{formattedDate}</span>
              {review.editCount > 0 && (
                <span className="text-[11px] text-neutral-400 italic">
                  (Đã chỉnh sửa)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action dropdown for owner */}
        {(canEdit || canDelete) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors"
              aria-label="Tùy chọn đánh giá"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-neutral-200 rounded-xl shadow-lg py-1 z-10 text-xs">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit?.(review);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-neutral-700 hover:bg-neutral-50 transition-colors text-left"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-neutral-500" />
                    <span>Chỉnh sửa</span>
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete?.(review);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-rose-600 hover:bg-rose-50 transition-colors text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa đánh giá</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fit Feedback Badge */}
      {fitInfo && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 font-medium">Độ vừa vặn:</span>
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${fitInfo.badgeClass}`}>
            {fitInfo.label}
          </span>
        </div>
      )}

      {/* Comment Body */}
      {review.comment && (
        <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line">
          {review.comment}
        </p>
      )}

      {/* Media Attachments (Photos & Video) */}
      {((review.images && review.images.length > 0) || review.video) && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {review.images?.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSelectedMedia(url);
                setIsVideoModal(false);
              }}
              className="relative w-16 h-16 rounded-xl overflow-hidden border border-neutral-200 group focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Xem ảnh phóng to"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Ảnh đánh giá ${idx + 1}`}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          ))}

          {review.video && (
            <button
              type="button"
              onClick={() => {
                setSelectedMedia(review.video!);
                setIsVideoModal(true);
              }}
              className="relative w-16 h-16 rounded-xl bg-neutral-900 border border-neutral-200 flex items-center justify-center group focus:outline-none focus:ring-2 focus:ring-primary/40 text-white"
              title="Xem video đánh giá"
            >
              <div className="p-2 rounded-full bg-white/20 group-hover:bg-white/30 transition-colors">
                <Play className="w-4 h-4 fill-white" />
              </div>
            </button>
          )}
        </div>
      )}

      {/* Staff Reply Section */}
      {review.staffReply && (
        <div className="bg-neutral-50/90 border border-neutral-200/70 rounded-xl p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Phản hồi từ Cổ Phục Store</span>
          </div>
          <p className="text-xs text-neutral-600 leading-relaxed pl-5 whitespace-pre-line">
            {review.staffReply}
          </p>
        </div>
      )}

      {/* Lightbox Modal for Photo / Video Preview */}
      {selectedMedia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelectedMedia(null)}
        >
          <div
            className="relative max-w-2xl max-h-[90vh] bg-neutral-900 rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedMedia(null)}
              className="absolute right-3 top-3 p-1.5 text-white/80 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors z-10"
              aria-label="Đóng xem trước"
            >
              <X className="w-5 h-5" />
            </button>

            {isVideoModal ? (
              <video
                src={selectedMedia}
                controls
                autoPlay
                className="max-h-[80vh] w-auto rounded-2xl"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedMedia}
                alt="Phóng to ảnh đánh giá"
                className="max-h-[80vh] w-auto object-contain rounded-2xl"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

