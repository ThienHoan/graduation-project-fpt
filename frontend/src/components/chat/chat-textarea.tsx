"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

type ChatTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "onChange" | "onInput"
> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Textarea cho phép IME tiếng Việt tự quản lý nội dung đang gõ.
 *
 * Với textarea controlled thông thường, React có thể ghi đè DOM bằng state cũ
 * ngay giữa lúc bộ gõ đang ghép chữ (ví dụ "đẹp" bị thành "dedep"). Component
 * này để DOM sở hữu chuỗi đang gõ và chỉ đồng bộ lại khi giá trị từ bên ngoài
 * thay đổi thật sự (chèn câu trả lời AI, xoá sau khi gửi...).
 */
export function ChatTextarea({
  value,
  onValueChange,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
  ...props
}: ChatTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initialValueRef = useRef(value);
  const composingRef = useRef(false);

  useEffect(() => {
    if (composingRef.current) return;

    const textarea = textareaRef.current;
    if (textarea && textarea.value !== value) {
      textarea.value = value;
    }
  }, [value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      defaultValue={initialValueRef.current}
      onInput={(event) => onValueChange(event.currentTarget.value)}
      onCompositionStart={(event) => {
        composingRef.current = true;
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        onValueChange(event.currentTarget.value);
        onCompositionEnd?.(event);
      }}
      onBlur={(event) => {
        composingRef.current = false;
        onBlur?.(event);
      }}
    />
  );
}
