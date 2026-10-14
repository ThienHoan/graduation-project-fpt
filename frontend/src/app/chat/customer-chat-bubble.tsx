"use client";

import { useRef, useEffect, useState, type RefObject } from "react";
import type { ChatConversation, ChatMessage } from "@/lib/chat";
import { getBookingCardData, getProductCardData, uploadChatFile } from "@/lib/chat";
import type { AuthSession } from "@/lib/auth";
import { BookingCard } from "@/components/chat/booking-card";
import { ProductCard } from "@/components/chat/product-card";
import { Paperclip, X, RotateCcw, Minus, MessageCircle, Send, Bot, Loader2 } from "lucide-react";

const CHAT_BUBBLE_OPEN_KEY = "co_phuc_chat_bubble_open";

interface CustomerChatBubbleProps {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  messageText: string;
  setMessageText: (text: string) => void;
  typingUsers: Record<string, boolean>;
  loadingMessages: boolean;
  session: AuthSession | null;
  onSendMessage: () => void;
  onTyping: (isTyping: boolean) => void;
  hasMoreMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onDeleteMessage: (messageId: string) => void;
  failedMessages?: Set<string>;
  onRetryMessage?: (content: string) => void;
}

export function CustomerChatBubble({
  conversation,
  messages,
  messageText,
  setMessageText,
  typingUsers,
  loadingMessages,
  session,
  onSendMessage,
  onTyping,
  hasMoreMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  messagesContainerRef,
  onDeleteMessage,
  failedMessages,
  onRetryMessage,
}: CustomerChatBubbleProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // const [isOpen, setIsOpen] = useState(() => {
  //   // Restore open state from localStorage on page load
  //   if (typeof window === "undefined") return false;
  //   return window.localStorage.getItem(CHAT_BUBBLE_OPEN_KEY) === "true";
  // });
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !conversation) return;
    setUploading(true);
    try {
      await uploadChatFile(conversation.id, file);
    } catch {
      const maxMB = 50;
      showToast(`Không thể tải file lên. File phải là hình ảnh hoặc video, dung lượng tối đa ${maxMB}MB.`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  const typingEntries = Object.entries(typingUsers)
    .filter(([, isTyping]) => isTyping)
    .map(([userId]) => userId);

  // Persist open state to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_BUBBLE_OPEN_KEY, isOpen ? "true" : "false");
  }, [isOpen]);

  // Cho phép các màn khác (vd dashboard khách) ra hiệu mở khung chat.
  useEffect(() => {
    const openChat = () => setIsOpen(true);
    window.addEventListener("chat:open", openChat);
    return () => window.removeEventListener("chat:open", openChat);
  }, []);

  useEffect(() => {
    if (messagesEndRef.current?.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [messages]);

  // Handle scroll to top to load older messages
  function handleMessagesScroll() {
    const container = messagesContainerRef.current;
    if (!container || !hasMoreMessages || loadingOlderMessages) return;

    // If scrolled near the top (within 50px), load older messages
    if (container.scrollTop <= 50) {
      onLoadOlderMessages();
    }
  }

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col">
      {/* Chat Widget */}
      {isOpen && (
        <div className="mb-3 flex h-[600px] w-88 flex-col overflow-hidden rounded-2xl border border-sand bg-white shadow-2xl">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-oxblood to-lotus px-4 py-3.5 text-white">
            <div className="flex-1">
              <h3 className="font-display text-base font-semibold tracking-wide text-white">Hộp thư CSKH</h3>
              <p className="text-xs text-stone-200">Đội ngũ Cổ Phục hỗ trợ 24/7</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Đóng chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages Container - fixed height, scrollable */}
          <div
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            className="flex-1 overflow-y-auto p-3 space-y-3 bg-parchment"
          >
            {/* Loading older indicator */}
            {loadingOlderMessages && (
              <div className="text-center text-xs text-stone-500 py-1">Đang tải tin nhắn cũ hơn...</div>
            )}
            {hasMoreMessages && !loadingOlderMessages && messages.length > 0 && (
              <div className="text-center text-[10px] text-stone-400 py-1">Cuộn lên để xem tin nhắn cũ</div>
            )}

            {!conversation ? (
              <div className="text-xs text-stone-500">Đang kết nối...</div>
            ) : loadingMessages ? (
              <div className="text-xs text-stone-500">Đang tải tin nhắn...</div>
            ) : messages.length === 0 ? (
              <div className="rounded-xl border border-sand/70 bg-white/80 p-3 text-xs leading-relaxed text-stone-600">
                Kính chào quý khách! Đây là hộp thư hỗ trợ trực tuyến của Cổ Phục. Quý khách có thể để lại tin nhắn hoặc yêu cầu hỗ trợ đơn thuê.
              </div>
            ) : (
              <>
                {messages.map((message) => {
                  const isMine = message.sender_id === session?.user.id;
                  return (
                    <div
                      key={message.id}
                      className={`group relative flex ${isMine ? "justify-end" : "justify-start"}`}
                      onMouseEnter={() => setHoveredMessageId(message.id)}
                      onMouseLeave={() => setHoveredMessageId(null)}
                    >
                      <div className={`${isMine ? "" : ""} max-w-[90%]`}>
                        {message.deleted_at ? (
                          <div className="italic text-stone-400 text-xs px-3 py-2">Tin nhắn đã bị xóa</div>
                        ) : message.message_type === "booking_card" ? (
                          (() => {
                            const data = getBookingCardData(message);
                            return data?.booking ? (
                              <BookingCard booking={data.booking} viewerRole="customer" />
                            ) : (
                              <div className="text-xs text-stone-500">Không thể hiển thị đơn hàng</div>
                            );
                          })()
                        ) : message.message_type === "image" && message.metadata?.url ? (
                          <div className={`${isMine ? "" : ""} max-w-[240px]`}>
                            <img
                              src={message.metadata.url as string}
                              alt=""
                              className="rounded-lg border border-sand/70 shadow-sm w-full h-auto object-cover"
                              loading="lazy"
                            />
                            <span className="block text-[10px] mt-1 opacity-70 text-right">
                              {new Date(message.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ) : message.message_type === "video" && message.metadata?.url ? (
                          <div className={`${isMine ? "" : ""} max-w-[240px]`}>
                            <video
                              src={message.metadata.url as string}
                              controls
                              className="rounded-lg border border-sand/70 shadow-sm w-full h-auto max-h-[320px] object-contain bg-black"
                              preload="metadata"
                            />
                            <span className="block text-[10px] mt-1 opacity-70 text-right">
                              {new Date(message.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ) : message.message_type === "product_card" ? (
                          (() => {
                            const product = getProductCardData(message);
                            return product ? (
                              <ProductCard product={product} />
                            ) : (
                              <div className="text-xs text-stone-500">Không thể hiển thị sản phẩm</div>
                            );
                          })()
                          ) : message.sender_type === "ai" ? (
                          <div className="rounded-xl border border-sand/70 bg-stone-50 px-3 py-2 text-xs shadow-sm max-w-[90%]">
                            <p className="flex items-center gap-1 text-[10px] font-semibold text-stone-500 mb-1">
                              <Bot className="h-3 w-3 text-lotus" /> Trợ lý Cổ Phục AI
                            </p>
                            <p className="leading-5 text-stone-800">{message.content}</p>
                            <span className="block text-[10px] mt-1 opacity-70 text-stone-500">
                              {new Date(message.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={`${
                              isMine ? "bg-lotus text-white" : "bg-white border border-sand/70 text-stone-900"
                            } rounded-xl px-3.5 py-2 text-xs shadow-xs`}
                          >
                            <p className="leading-5">{message.content}</p>
                            <span className="block text-[10px] mt-1 opacity-70">
                              {new Date(message.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        )}
                      </div>
                      {/* Delete button */}
                      {isMine && !message.deleted_at && hoveredMessageId === message.id && (
                        <button
                          type="button"
                          onClick={() => onDeleteMessage(message.id)}
                          className="absolute -top-2 -right-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white shadow-sm hover:bg-red-700 transition"
                          title="Xoá tin nhắn"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      {/* Retry button for failed messages */}
                      {isMine && message.id.startsWith("temp-") && failedMessages?.has(message.id) && (
                        <button
                          type="button"
                          onClick={() => onRetryMessage?.(message.content)}
                          className="absolute -bottom-2 -right-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-600 text-white shadow-sm hover:bg-amber-700 transition"
                          title="Gửi lại"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </>
            )}

            {typingUsers["ai-assistant"] && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-900 shadow-xs">
                  <Bot className="h-3.5 w-3.5 text-amber-700" />
                  <span>Trợ lý AI đang soạn câu trả lời...</span>
                </div>
              </div>
            )}
            {typingEntries.some((id) => id !== "ai-assistant") && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 bg-white border border-sand/70 rounded-xl px-3 py-2 text-xs text-stone-600 shadow-xs">
                  <span>Nhân viên đang soạn tin...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="border-t border-sand/70 bg-white p-3 shrink-0">
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleUploadFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !conversation}
                className="inline-flex items-center justify-center rounded-xl w-9 h-9 border border-sand bg-mist text-stone-500 transition hover:bg-sand/40 hover:text-stone-700 disabled:opacity-50 shrink-0"
                aria-label="Đính kèm file"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin text-lotus" /> : <Paperclip className="w-4 h-4" />}
              </button>
              <textarea
                rows={2}
                value={messageText}
                onChange={(event) => setMessageText(event.currentTarget.value)}
                onFocus={() => onTyping(true)}
                onBlur={() => onTyping(false)}
                className="flex-1 rounded-xl border border-sand bg-mist px-3 py-2 text-xs outline-none focus:border-lotus focus:bg-white resize-none"
                placeholder="Nhập tin nhắn..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSendMessage();
                  }
                }}
              />
              <button
                type="button"
                onClick={onSendMessage}
                className="inline-flex items-center justify-center rounded-xl w-9 h-9 bg-lotus text-white transition hover:bg-oxblood shrink-0 shadow-sm"
                aria-label="Gửi"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="mb-2 rounded-xl bg-oxblood px-4 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Toggle Button - always visible */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-center w-14 h-14 rounded-full shadow-xl font-semibold text-white transition transform active:scale-95 ${
          isOpen
            ? "bg-stone-500 hover:bg-stone-600"
            : "bg-oxblood hover:bg-lotus"
        }`}
        aria-label={isOpen ? "Đóng chat" : "Mở chat"}
      >
        {isOpen ? (
          <Minus className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}