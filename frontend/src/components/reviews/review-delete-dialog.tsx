"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";

export type ReviewDeleteDialogProps = {
  isOpen: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ReviewDeleteDialog({
  isOpen,
  isDeleting,
  onConfirm,
  onClose,
}: ReviewDeleteDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-2xl p-6 shadow-xl border border-neutral-100">
        <button
          type="button"
          onClick={onClose}
          disabled={isDeleting}
          className="absolute right-4 top-4 p-1 text-neutral-400 hover:text-neutral-600 rounded-full hover:bg-neutral-100 transition-colors disabled:opacity-50"
          aria-label="Đóng"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 text-rose-600 mb-3">
          <div className="p-2.5 bg-rose-50 rounded-xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 id="delete-dialog-title" className="text-lg font-bold text-neutral-900">
            Xác nhận xóa đánh giá
          </h3>
        </div>

        <p className="text-sm text-neutral-600 leading-relaxed">
          Bạn có chắc chắn muốn xóa đánh giá này? Hành động này sẽ xóa vĩnh viễn nội dung và hình ảnh kèm theo khỏi hệ thống và không thể hoàn tác.
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors disabled:opacity-50"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
          >
            {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Xác nhận xóa</span>
          </button>
        </div>
      </div>
    </div>
  );
}

