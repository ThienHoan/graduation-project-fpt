"use client";

import { useRef, useEffect, useState, type RefObject } from "react";
import type { ChatConversation, ChatHandoff, ChatMessage, ConversationLockStatus, StaffConversationTab } from "@/lib/chat";
import { getBookingCardData, getProductCardData, uploadChatFile, getStaffSuggestion, sendProductCardMessage, getChatConversationCounts, type ChatSuggestionTopic } from "@/lib/chat";
import { Paperclip, Sparkles, Send, Loader2, CheckCircle2, Bot, X, RotateCcw, ChevronDown, ChevronUp, CornerUpLeft, AlertTriangle } from "lucide-react";
import type { AuthSession } from "@/lib/auth";
import { BookingCard } from "@/components/chat/booking-card";
import { ChatTextarea } from "@/components/chat/chat-textarea";
import { ProductCard } from "@/components/chat/product-card";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

const DEFAULT_PRODUCT_IMAGE = "https://dep.com.vn/wp-content/uploads/2020/11/ao-dai-9.jpg";

// Thông điệp thân thiện khi trợ lý AI không trả được kết quả (model lỗi,
// timeout, quá tải, dữ liệu không hợp lệ...). Tránh hiển thị "Bad Request".
const AI_UNAVAILABLE_MESSAGE =
  "Trợ lý AI hiện không thể hỗ trợ vấn đề này. Vui lòng thử lại sau hoặc trả lời khách trực tiếp.";

const HANDOFF_TONE: Record<ChatHandoff["group"], string> = {
  complaint: "border-red-200 bg-red-50 text-red-700",
  payment: "border-amber-200 bg-amber-50 text-amber-800",
  bot: "border-stone-200 bg-stone-100 text-stone-600",
};

/** Nhãn lý do chuyển nhân viên. Không hiển thị số tin: con số đó là số lần
 * bot phải đẩy handoff, không phải số tin khách chờ và rất dễ hiểu sai. */
function HandoffBadge({ handoff, className = "" }: { handoff: ChatHandoff; className?: string }) {
  const tone = handoff.expired
    ? "border-stone-200 bg-white text-stone-400"
    : HANDOFF_TONE[handoff.group];
  const openedAt = handoff.openedAt
    ? new Date(handoff.openedAt).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <span
      title={[
        openedAt ? `Bot chuyển nhân viên lúc ${openedAt}` : "Bot chuyển nhân viên",
        handoff.label,
        handoff.sensitive ? "Nhạy cảm — bot đang bị chặn tư vấn" : null,
        handoff.expired ? "Đã quá hạn xử lý" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tone} ${className}`}
    >
      {handoff.sensitive && <AlertTriangle className="h-3 w-3 shrink-0" />}
      <span>{handoff.label}</span>
      {handoff.expired && <span className="font-normal normal-case tracking-normal">· Quá hạn</span>}
    </span>
  );
}

function handoffTooltip(handoff: ChatHandoff) {
  const openedAt = handoff.openedAt
    ? new Date(handoff.openedAt).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return [
    openedAt ? `Bot chuyển nhân viên lúc ${openedAt}` : "Bot chuyển nhân viên",
    handoff.label,
    handoff.sensitive ? "Hội thoại nhạy cảm: bot tạm dừng tư vấn" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface StaffChatWorkspaceProps {
  conversations: ChatConversation[];
  selectedConversation: ChatConversation | null;
  messages: ChatMessage[];
  messageText: string;
  setMessageText: (text: string) => void;
  typingUsers: Record<string, boolean>;
  typingEntries: string[];
  loadingConversations: boolean;
  loadingMessages: boolean;
  lockStatus: ConversationLockStatus | null;
  staffCanReply: boolean;
  staffLockError: string | null;
  sidebarTab: StaffConversationTab;
  setSidebarTab: (tab: StaffConversationTab) => void;
  notification: string | null;
  session: AuthSession | null;
  onJoinConversation: (conversationId: string) => void;
  onSendMessage: () => void;
  onOpenConversation: () => void;
  onResolveConversation: () => void;
  onStartManagerSupport: () => void;
  onEndManagerSupport: () => void;
  managerSupportLoading: boolean;

  onTyping: (isTyping: boolean) => void;
  hasMoreMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onDeleteMessage: (messageId: string) => void;
  /** Staff chỉ xoá được tin của mình khi đang giữ lock trả lời hội thoại. */
  canDeleteMessages: boolean;
  failedMessages?: Set<string>;
  onRetryMessage?: (content: string) => void;
  /** Tin đang được trích dẫn để trả lời (kiểu reply Messenger). */
  replyTarget?: { id: string; content: string; senderLabel: string } | null;
  onReplyToMessage?: (message: ChatMessage) => void;
  onCancelReply?: () => void;
}

export function StaffChatWorkspace({
  conversations,
  selectedConversation,
  messages,
  messageText,
  setMessageText,
  typingUsers,
  typingEntries,
  loadingConversations,
  loadingMessages,
  lockStatus,
  staffCanReply,
  staffLockError,
  sidebarTab,
  setSidebarTab,
  notification,
  session,
  onJoinConversation,
  onSendMessage,
  onOpenConversation,
  onResolveConversation,
  onStartManagerSupport,
  onEndManagerSupport,
  managerSupportLoading,
  onTyping,
  hasMoreMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  messagesContainerRef,
  onDeleteMessage,
  canDeleteMessages,
  failedMessages,
  onRetryMessage,
  replyTarget,
  onReplyToMessage,
  onCancelReply,
}: StaffChatWorkspaceProps) {
  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (uploadToastTimerRef.current) clearTimeout(uploadToastTimerRef.current);
    };
  }, []);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  // Tin gây ra handoff: cuộn tới đúng divider khi staff bấm badge.
  const handoffDividerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [tabCounts, setTabCounts] = useState({
    needsReply: 0,
    awaitingReply: 0,
    unassigned: 0,
    waitingCustomer: 0,
    resolved: 0,
  });

  useEffect(() => {
    getChatConversationCounts().then((res) => {
      if (res.success && res.data) {
        setTabCounts(res.data);
      }
    });
  }, [conversations]);
  const [uploading, setUploading] = useState(false);
  const [uploadToast, setUploadToast] = useState<string | null>(null);
  const uploadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiSuggestion, setAiSuggestion] = useState<{
    loading: boolean;
    topics: ChatSuggestionTopic[];
    error: string | null;
  }>({ loading: false, topics: [], error: null });
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  // Nội dung tin khách mà gợi ý đang trả lời (tin được chọn hoặc tin mới nhất)
  // — chỉ để hiển thị, không gửi đi.
  const [aiSuggestionTarget, setAiSuggestionTarget] = useState<{
    content: string;
    selected: boolean;
  } | null>(null);
  // Tăng mỗi khi đổi hội thoại / bắt đầu request mới để bỏ qua response cũ.
  const aiRequestIdRef = useRef(0);
  const [aiToast, setAiToast] = useState<string | null>(null);
  const aiToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const isManager = session?.user.role === "manager_owner";

  function showAiToast(msg: string) {
    setAiToast(msg);
    if (aiToastTimerRef.current) clearTimeout(aiToastTimerRef.current);
    aiToastTimerRef.current = setTimeout(() => setAiToast(null), 3000);
  }

  function showUploadToast(msg: string) {
    setUploadToast(msg);
    if (uploadToastTimerRef.current) clearTimeout(uploadToastTimerRef.current);
    uploadToastTimerRef.current = setTimeout(() => setUploadToast(null), 3000);
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;
    setUploading(true);
    try {
      await uploadChatFile(selectedConversation.id, file);
    } catch {
      const maxMB = 50;
      showUploadToast(`Không thể tải file lên. File phải là hình ảnh hoặc video, dung lượng tối đa ${maxMB}MB.`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const displayedConversations = conversations;

  const generalTabs: Array<{ key: StaffConversationTab; label: string; count: number }> = [
    { key: "unassigned", label: "Chờ tiếp nhận", count: tabCounts.unassigned ?? 0 },
    { key: "resolved", label: "Đã tư vấn", count: tabCounts.resolved ?? 0 },
    { key: "waiting_customer", label: "Chờ khách", count: tabCounts.waitingCustomer ?? 0 },
  ];
  const personalTabs: Array<{ key: StaffConversationTab; label: string; count: number }> = [
    { key: "awaiting_reply", label: "Chờ phản hồi", count: tabCounts.awaitingReply ?? 0 },
    { key: "needs_reply", label: "Cần trả lời", count: tabCounts.needsReply ?? 0 },
  ];

  // Determine the viewing mode
  const isUnassignedPreview = selectedConversation && selectedConversation.staffId === null;
  const isAssignedToOther = selectedConversation && selectedConversation.staffId !== null && selectedConversation.staffId !== session?.user.id;
  const isResolved = selectedConversation?.status === "resolved";
  const managerSupportExpired = selectedConversation?.managerSupportExpiresAt
    ? new Date(selectedConversation.managerSupportExpiresAt).getTime() <= Date.now()
    : false;
  const managerSupportActive = Boolean(
    selectedConversation?.managerSupportBy &&
      !managerSupportExpired,
  );
  const managerSupportByMe =
    managerSupportActive && selectedConversation?.managerSupportBy === session?.user.id;
  const managerSupportByOther =
    managerSupportActive && selectedConversation?.managerSupportBy !== session?.user.id;
  // Quản lý đang hỗ trợ dùng chung composer nhưng không cần staff lock.
  const canReplyNow = staffCanReply || managerSupportByMe;
  // Chỉ gợi ý AI khi hội thoại thuộc quyền trả lời của người đang xem:
  // hội thoại đang mở của mình, hoặc hội thoại resolved do chính mình hỗ trợ.
  const canUseAiSuggestion =
    Boolean(selectedConversation) &&
    !isUnassignedPreview &&
    !isAssignedToOther &&
    (!isResolved || managerSupportByMe);
  // Panel chỉ mở khi đã có kết quả/lỗi hoặc đang chờ AI trả lời.
  const hasAiSuggestion =
    aiSuggestion.loading || aiSuggestion.topics.length > 0 || Boolean(aiSuggestion.error);

  function hasActiveManagerSupport(conversation: ChatConversation | null | undefined) {
    if (!conversation?.managerSupportBy) return false;
    if (!conversation.managerSupportExpiresAt) return true;
    return new Date(conversation.managerSupportExpiresAt).getTime() > Date.now();
  }

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      // Chỉ cuộn khung tin nhắn, tránh scrollIntoView làm nhảy thanh cuộn trang.
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Đổi hội thoại: xoá gợi ý của hội thoại trước để tránh hiển thị lẫn chủ đề.
  // Không tự gọi AI khi mở hội thoại — chỉ gọi khi người dùng bấm nút gợi ý.
  useEffect(() => {
    aiRequestIdRef.current += 1;
    setAiSuggestion({ loading: false, topics: [], error: null });
    setAiSuggestionTarget(null);
    setAiPanelOpen(false);
  }, [selectedConversation?.id]);

  async function handleRequestAiSuggestion() {
    if (!selectedConversation || !session || aiSuggestion.loading) return;
    if (!canUseAiSuggestion) return;

    setAiPanelOpen(true);

    // Nếu staff đang chọn "trả lời" một tin của khách thì gợi ý phải trả lời
    // đúng tin đó, với ngữ cảnh là ~5 tin ngay trước nó. Chọn nhầm tin của
    // staff/hệ thống thì quay lại hành vi mặc định (tin khách mới nhất).
    const targetMsg = replyTarget
      ? messages.find(
          (m) =>
            m.id === replyTarget.id &&
            m.sender_id === selectedConversation.customerId &&
            !m.deleted_at &&
            (!m.message_type || m.message_type === "text") &&
            /[\p{L}\p{N}]/u.test(m.content ?? ""),
        )
      : undefined;

    // Chỉ tin nhắn thật của khách mới dùng làm nội dung gợi ý.
    const lastCustomerMsg =
      targetMsg ??
      [...messages].reverse().find(
        (m) =>
          m.sender_id === selectedConversation.customerId &&
          !m.deleted_at &&
          (!m.message_type || m.message_type === "text") &&
          /[\p{L}\p{N}]/u.test(m.content ?? ""),
      );
    if (!lastCustomerMsg) {
      const noMessage = "Chưa có tin nhắn văn bản nào từ khách để gợi ý.";
      setAiSuggestion({ loading: false, topics: [], error: noMessage });
      showAiToast(noMessage);
      return;
    }

    // Response của request cũ (hội thoại khác / lần gợi ý trước) bị bỏ qua.
    const requestId = ++aiRequestIdRef.current;
    setAiSuggestionTarget({
      content: lastCustomerMsg.content ?? "",
      selected: Boolean(targetMsg),
    });
    setAiSuggestion({ loading: true, topics: [], error: null });

    try {
      // Backend định tuyến STAFF > FAQ > DB > AI, cache theo messageId —
      // không gọi thẳng model từ trình duyệt. messageId = tin khách được chọn
      // (nếu có) để ngữ cảnh và câu trả lời bám đúng tin đó.
      const res = await getStaffSuggestion(
        selectedConversation.id,
        lastCustomerMsg.id,
      );
      if (aiRequestIdRef.current !== requestId) return;

      if (res.success && res.data) {
        setAiSuggestion({ loading: false, topics: res.data.topics, error: null });
        return;
      }

      // Mọi lỗi từ phía AI (Bad Request, hết hạn mức, model lỗi...) đều hiển
      // thị một thông điệp thân thiện thay vì mã lỗi kỹ thuật.
      setAiSuggestion({ loading: false, topics: [], error: AI_UNAVAILABLE_MESSAGE });
      showAiToast(AI_UNAVAILABLE_MESSAGE);
    } catch {
      if (aiRequestIdRef.current !== requestId) return;
      setAiSuggestion({ loading: false, topics: [], error: AI_UNAVAILABLE_MESSAGE });
      showAiToast(AI_UNAVAILABLE_MESSAGE);
    }
  }

  async function handleInsertProductCard(productId: string) {
    if (!selectedConversation) return;
    try {
      await sendProductCardMessage({
        conversationId: selectedConversation.id,
        productId,
      });
      showAiToast(`Đã gửi product card`);
    } catch {
      showAiToast("Không thể gửi product card.");
    }
  }

  function handleInsertReply(reply: string) {
    setMessageText(reply);
    setAiPanelOpen(false);
  }

  // Handle scroll to top to load older messages
  function handleMessagesScroll() {
    const container = messagesContainerRef.current;
    if (!container || !hasMoreMessages || loadingOlderMessages) return;

    // If scrolled near the top (within 50px), load older messages
    if (container.scrollTop <= 50) {
      onLoadOlderMessages();
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      {/* Sidebar */}
      <aside className="rounded-lg border border-sand bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-lg text-ink">Cuộc trò chuyện</h2>
        </div>

        <div className="mb-5 rounded-lg bg-parchment p-3 text-sm text-stone-700">
          <div>
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Chung
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {generalTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSidebarTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 transition ${
                    sidebarTab === tab.key
                      ? "bg-oxblood text-white"
                      : "bg-white text-stone-700 hover:bg-sand"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none ${
                      sidebarTab === tab.key
                        ? "bg-white/20 text-white"
                        : "bg-stone-200 text-stone-600"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-sand/70 pt-3">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Cá nhân
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {personalTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSidebarTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 transition ${
                    sidebarTab === tab.key
                      ? "bg-oxblood text-white"
                      : "bg-white text-stone-700 hover:bg-sand"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none ${
                      sidebarTab === tab.key
                        ? "bg-white/20 text-white"
                        : "bg-stone-200 text-stone-600"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {loadingConversations ? (
            <div className="text-sm text-stone-500">Đang tải cuộc trò chuyện...</div>
          ) : displayedConversations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-sand/70 bg-mist p-4 text-sm text-stone-500">
              Không có cuộc trò chuyện nào.
            </div>
          ) : (
            displayedConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => void onJoinConversation(conversation.id)}
                className={`w-full rounded-lg border px-4 py-4 text-left transition ${conversation.id === selectedConversation?.id ? "border-lotus bg-lotus/10" : "border-sand bg-white hover:border-lotus/80"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Khách hàng: {conversation.customerName}</p>
                    <p className="mt-1 text-xs text-stone-500">Nhân viên: {conversation.staffName ?? "Chưa có"}</p>
                    {hasActiveManagerSupport(conversation) && (
                      <span className="mt-1 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-700">
                        {conversation.managerSupportBy === session?.user.id ? "Bạn đang hỗ trợ" : "Quản lý đang hỗ trợ"}
                      </span>
                    )}
                    {conversation.handoff && (
                      <span className="mt-1 block">
                        <HandoffBadge handoff={conversation.handoff} />
                      </span>
                    )}
                    {conversation.topic && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {conversation.topic === "product_advice" && conversation.garmentName ? (
                          <>
                            <span className="inline-flex items-center gap-1 rounded-full bg-jade/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-jade">
                              Tư vấn sản phẩm
                            </span>
                            <span className="truncate text-[11px] text-jade max-w-[140px]">
                              {conversation.garmentName}
                            </span>
                          </>
                        ) : conversation.topic === "booking_support" && conversation.bookingId ? (
                          <>
                            <span className="inline-flex items-center gap-1 rounded-full bg-lotus/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lotus">
                              Hỗ trợ đơn hàng
                            </span>
                            <span className="truncate text-[11px] text-lotus max-w-[140px]">
                              #{conversation.bookingId.substring(0, 8).toUpperCase()}
                            </span>
                          </>
                        ) : conversation.topic === "complaint" && conversation.bookingId ? (
                          <>
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-700">
                              Khiếu nại
                            </span>
                            <span className="truncate text-[11px] text-rose-600 max-w-[140px]">
                              #{conversation.bookingId.substring(0, 8).toUpperCase()}
                            </span>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                            General
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span className="rounded-full bg-sand/80 px-2 py-1 text-[11px] uppercase text-stone-600">{conversation.unreadCount} mới</span>
                  )}
                </div>
                {conversation.lastMessage && (
                  <p className="mt-3 text-sm text-stone-600 line-clamp-2">
                    {conversation.lastMessage.message_type === "booking_card"
                      ? `📋 Đơn #${getBookingCardData(conversation.lastMessage)?.booking?.code ?? ""}`
                      : conversation.lastMessage.message_type === "product_card"
                        ? getProductCardData(conversation.lastMessage)?.name ?? "Sản phẩm"
                        : conversation.lastMessage.message_type === "image"
                          ? "📷 Hình ảnh"
                          : conversation.lastMessage.message_type === "video"
                            ? "🎬 Video"
                            : conversation.lastMessage.content}
                  </p>
                )}
              </button>
            ))
          )}
        </div>

        {/* Notification Toast */}
        {notification && (
          <div className="mt-4 rounded-lg bg-lotus/10 border border-lotus px-4 py-3 text-sm font-semibold text-lotus animate-pulse">
            {notification}
          </div>
        )}
      </aside>

      {/* Main Chat Area */}
      <section className="rounded-lg border border-sand bg-white p-6 shadow-sm flex flex-col">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-lg text-ink">{selectedConversation ? `Chat với ${selectedConversation.customerName}` : "Chọn cuộc trò chuyện"}</h2>
            {selectedConversation && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {selectedConversation.topic === "product_advice" && selectedConversation.garmentName ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-jade/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-jade">
                      Tư vấn sản phẩm
                    </span>
                    <span className="text-sm text-jade">{selectedConversation.garmentName}</span>
                  </>
                ) : selectedConversation.topic === "booking_support" && selectedConversation.bookingId ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-lotus/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-lotus">
                      Hỗ trợ đơn hàng
                    </span>
                    <span className="text-sm text-lotus">Mã đơn: #{selectedConversation.bookingId.substring(0, 8).toUpperCase()}</span>
                  </>
                ) : selectedConversation.topic === "complaint" && selectedConversation.bookingId ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-700">
                      Khiếu nại
                    </span>
                    <span className="text-sm text-rose-600">Mã đơn: #{selectedConversation.bookingId.substring(0, 8).toUpperCase()}</span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    General
                  </span>
                )}
                {isResolved && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-600">
                    Đã tư vấn
                  </span>
                )}
                {selectedConversation.handoff && (
                  <button
                    type="button"
                    onClick={() =>
                      handoffDividerRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      })
                    }
                    title={handoffTooltip(selectedConversation.handoff)}
                    className="cursor-pointer"
                  >
                    <HandoffBadge handoff={selectedConversation.handoff} />
                  </button>
                )}
              </div>
            )}
          </div>

          {selectedConversation && (
            <div className="flex gap-2">
              {isUnassignedPreview && !isResolved ? (
                <button
                  type="button"
                  onClick={onOpenConversation}
                  className="rounded-full bg-lotus px-5 py-2 text-sm font-semibold text-white transition hover:bg-oxblood"
                >
                  Tiếp nhận hỗ trợ
                </button>
              ) : isManager && isResolved && managerSupportByMe ? (
                <button
                  type="button"
                  onClick={onEndManagerSupport}
                  disabled={managerSupportLoading}
                  className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {managerSupportLoading ? "Đang kết thúc..." : "Kết thúc hỗ trợ"}
                </button>
              ) : isResolved && managerSupportByOther ? (
                <div className="rounded-full px-5 py-2 text-sm font-semibold text-indigo-700">
                  Quản lý đang hỗ trợ
                </div>
              ) : isManager && isResolved ? (
                <button
                  type="button"
                  onClick={onStartManagerSupport}
                  disabled={managerSupportLoading}
                  className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {managerSupportLoading ? "Đang mở..." : "Nhắn khách với tư cách quản lý"}
                </button>
              ) : isResolved && !managerSupportActive && selectedConversation.staffId === session?.user.id ? (
                <button
                  type="button"
                  onClick={onOpenConversation}
                  className="rounded-full bg-jade px-5 py-2 text-sm font-semibold text-white transition hover:bg-forest"
                >
                  Tư vấn bổ sung
                </button>
              ) : isResolved ? (
                <div className="rounded-full px-5 py-2 text-sm font-semibold text-stone-500">
                  Đã tư vấn bởi {selectedConversation.staffName ?? "nhân viên khác"}
                </div>
              ) : isAssignedToOther ? (
                <div className="rounded-full px-5 py-2 text-sm font-semibold text-stone-600">
                  Đang xử lý bởi {selectedConversation.staffName}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {selectedConversation ? (
          <>
            {/* Preview Banner for unassigned conversations */}
            {isUnassignedPreview && (
              <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 shrink-0">
                {String.fromCodePoint(0x1F50D)} Chế độ xem trước &mdash; Bạn đang xem tin nhắn. Nhấn <strong>&ldquo;Tiếp nhận hỗ trợ&rdquo;</strong> để nhận cuộc trò chuyện này.
              </div>
            )}

            {managerSupportByMe && (
              <div className="mb-5 rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 text-sm text-indigo-800 shrink-0">
                Bạn đang hỗ trợ với tư cách quản lý. Hội thoại vẫn ở trạng thái{" "}
                <strong>Đã tư vấn</strong> và vẫn thuộc{" "}
                <strong>{selectedConversation.staffName ?? "staff phụ trách"}</strong>. Khách trả lời sẽ chỉ báo cho bạn.
              </div>
            )}

            {managerSupportByOther && (
              <div className="mb-5 rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 text-sm text-indigo-800 shrink-0">
                Quản lý đang hỗ trợ hội thoại này. Bạn chỉ xem lịch sử; không gửi tin để tránh chồng chéo.
              </div>
            )}

            <div className="mb-5 grid gap-3 sm:grid-cols-2 shrink-0">
              <div className="rounded-lg bg-parchment p-4 text-sm text-stone-700">
                <div className="font-semibold text-stone-900">Tình trạng</div>
                <div className="mt-2">
                  {isUnassignedPreview ? (
                    <p className="text-sm text-amber-700">Chưa có nhân viên tiếp nhận</p>
                  ) : lockStatus?.isLocked ? (
                    <>
                      <p className="text-sm">Khoá bởi: {lockStatus.lockedBy?.name}</p>
                      <p className="text-sm">Hết hạn: {lockStatus.expiresAt ? new Date(lockStatus.expiresAt).toLocaleTimeString("vi-VN") : "-"}</p>
                    </>
                  ) : (
                    <p className="text-sm">Hiện chưa khoá</p>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-parchment p-4 text-sm text-stone-700">
                <div className="font-semibold text-stone-900">Quyền gửi</div>
                <div className="mt-2">
                  {isUnassignedPreview ? (
                    <p className="text-sm text-amber-700">Xem trước — chưa có quyền trả lời</p>
                  ) : managerSupportByOther ? (
                    <p className="text-sm text-indigo-700">Quản lý đang hỗ trợ — tạm khoá gửi tin</p>
                  ) : managerSupportByMe ? (
                    <p className="text-sm text-jade">Bạn đang hỗ trợ với tư cách quản lý</p>
                  ) : staffCanReply ? (
                    <p className="text-sm text-jade">Bạn hiện có quyền trả lời</p>
                  ) : (
                    <p className="text-sm text-red-700">{staffLockError ?? "Chưa mở khóa"}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Messages Container - fixed height, scrollable */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="mb-5 flex-1 min-h-0 overflow-y-auto rounded-lg border border-sand/70 bg-parchment p-4"
              style={{ maxHeight: "400px" }}
            >
              {/* Loading older indicator */}
              {loadingOlderMessages && (
                <div className="text-center text-sm text-stone-500 py-2">Đang tải tin nhắn cũ hơn...</div>
              )}
              {hasMoreMessages && !loadingOlderMessages && messages.length > 0 && (
                <div className="text-center text-xs text-stone-400 py-2">Cuộn lên để xem tin nhắn cũ</div>
              )}

              {loadingMessages ? (
                <div className="text-sm text-stone-500">Đang tải tin nhắn...</div>
              ) : messages.length === 0 ? (
                <div className="text-sm text-stone-500">Chưa có tin nhắn nào trong cuộc trò chuyện này.</div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => {
                    const isMine = message.sender_id === session?.user.id;
                    const isAi = message.sender_type === "ai";
                    // AI trả lời thay staff nên xếp cùng phía bên phải, nhưng dùng
                    // nền jade để staff phân biệt được đâu là tin do AI soạn.
                    const alignRight = isMine || isAi;
                    const bubbleClass = isAi
                      ? "bg-jade/10 text-ink border-jade/30"
                      : isMine
                        ? "bg-lotus/10 text-ink border-sand/70"
                        : "bg-white text-stone-900 border-sand/70";
                    const senderLabel = isMine
                      ? "Bạn"
                      : isAi
                        ? "Trợ lý AI"
                        : `${message.user_accounts?.profile?.fullName ?? message.user_accounts?.email ?? message.sender_id}${
                            message.metadata?.managerSupport ? " (Quản lý)" : ""
                          }`;
                    // Divider ngay trước tin khách đã kích hoạt handoff: staff mở
                    // hội thoại là thấy chính xác tin nào khiến bot chuyển người.
                    const handoff = selectedConversation?.handoff ?? null;
                    const isHandoffAnchor =
                      Boolean(handoff?.triggerMessageId) &&
                      handoff!.triggerMessageId === message.id;
                    // Tin gốc mà tin này trích dẫn (nếu có).
                    const replyTo = message.replyTo ?? null;
                    return (
                      <div key={message.id}>
                        {isHandoffAnchor && handoff && (
                          <div
                            ref={handoffDividerRef}
                            title={handoffTooltip(handoff)}
                            className="my-3 flex items-center gap-2"
                          >
                            <span className="h-px flex-1 bg-red-200" />
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-700">
                              {handoff.sensitive && <AlertTriangle className="h-3 w-3" />}
                              Bot chuyển nhân viên · {handoff.label}
                              {handoff.openedAt
                                ? ` · ${new Date(handoff.openedAt).toLocaleTimeString("vi-VN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}`
                                : ""}
                            </span>
                            <span className="h-px flex-1 bg-red-200" />
                          </div>
                        )}
                        <div
                          className={`group relative ${alignRight ? "ml-auto" : "mr-auto"} max-w-[85%]`}
                          onMouseEnter={() => setHoveredMessageId(message.id)}
                          onMouseLeave={() => setHoveredMessageId(null)}
                        >
                          <div className={`${bubbleClass} rounded-lg border px-4 py-3 shadow-sm`}>
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-stone-400">
                              <span className="inline-flex items-center gap-1.5">
                                {isAi && <Bot className="h-3.5 w-3.5 text-jade" />}
                                {senderLabel}
                              </span>
                              <span>{new Date(message.created_at).toLocaleTimeString("vi-VN")}</span>
                            </div>
                            {replyTo && !message.deleted_at && (
                              <div className="mb-2 rounded-md border-l-2 border-lotus/60 bg-white/70 px-2 py-1 text-xs text-stone-500">
                                <span className="block font-semibold text-lotus">Trả lời tin nhắn</span>
                                <span className="line-clamp-2 break-words">{replyTo.content}</span>
                              </div>
                            )}
                            {message.deleted_at ? (
                            <p className="text-sm italic text-stone-400">Tin nhắn đã bị xóa</p>
                          ) : message.message_type === "image" && message.metadata?.url ? (
                            <img
                              src={message.metadata.url as string}
                              alt=""
                              className="rounded-xl border border-sand/70 shadow-sm max-w-[260px] h-auto object-cover"
                              loading="lazy"
                            />
                          ) : message.message_type === "video" && message.metadata?.url ? (
                            <video
                              src={message.metadata.url as string}
                              controls
                              className="rounded-xl border border-sand/70 shadow-sm max-w-[260px] w-full h-auto max-h-[320px] object-contain bg-black"
                              preload="metadata"
                            />
                          ) : message.message_type === "booking_card" ? (
                            (() => {
                              const data = getBookingCardData(message);
                              return data?.booking ? (
                                <BookingCard booking={data.booking} viewerRole="staff" />
                              ) : (
                                <p className="text-sm text-stone-500">Không thể hiển thị đơn hàng</p>
                              );
                            })()
                          ) : message.message_type === "product_card" ? (
                            (() => {
                              const product = getProductCardData(message);
                              return product ? (
                                <ProductCard product={product} />
                              ) : (
                                <p className="text-sm text-stone-500">Không thể hiển thị sản phẩm</p>
                              );
                            })()
                          ) : message.sender_type === "ai" ? (
                            <p className="text-sm leading-6 text-stone-800">{message.content}</p>
                          ) : (
                            <p className="text-sm leading-6">{message.content}</p>
                          )}
                          </div>
                          {/* Trả lời trích dẫn: chỉ staff/manager, chỉ khi tin
                              không bị xoá và không phải tin tạm đang gửi. */}
                          {!isAi &&
                            !message.deleted_at &&
                            !message.id.startsWith("temp-") &&
                            canReplyNow &&
                            hoveredMessageId === message.id && (
                              <button
                                type="button"
                                onClick={() => onReplyToMessage?.(message)}
                                className={`absolute -top-3 ${alignRight ? "-left-3" : "-right-3"} inline-flex items-center justify-center w-6 h-6 rounded-full bg-lotus text-white shadow-sm hover:bg-oxblood transition`}
                                title="Trả lời tin nhắn này"
                              >
                                <CornerUpLeft className="h-3.5 w-3.5" />
                              </button>
                            )}
                          {/* Delete button - only for own messages while holding the reply lock */}
                        {isMine && canDeleteMessages && !message.deleted_at && hoveredMessageId === message.id && (
                          <button
                            type="button"
                            onClick={() => onDeleteMessage(message.id)}
                            className="absolute -top-2 -right-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white shadow-sm hover:bg-red-700 transition"
                            title="Xoá tin nhắn"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Retry button for failed messages */}
                        {isMine && message.id.startsWith("temp-") && failedMessages?.has(message.id) && (
                          <button
                            type="button"
                            onClick={() => onRetryMessage?.(message.content)}
                            className="absolute -bottom-2 -right-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-600 text-white shadow-sm hover:bg-amber-700 transition"
                            title="Gửi lại"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Upload Error Toast */}
            {uploadToast && (
              <div className="rounded-lg bg-oxblood px-4 py-3 text-sm text-white shadow-lg shrink-0">
                {uploadToast}
              </div>
            )}

            {/* AI Suggestion Panel — chỉ gọi AI khi người dùng bấm nút */}
            {canUseAiSuggestion && (
              <div className="rounded-lg border border-sand/70 bg-white shadow-sm shrink-0 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setAiPanelOpen((open) => !open)}
                    disabled={!hasAiSuggestion}
                    className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink disabled:cursor-default"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-lotus" />
                    <span className="truncate">Gợi ý AI</span>
                    {aiSuggestion.loading ? (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-stone-500">
                        <span className="inline-block w-3 h-3 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" />
                        Đang phân tích...
                      </span>
                    ) : hasAiSuggestion ? (
                      aiPanelOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-stone-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" />
                    ) : (
                      <span className="truncate text-xs font-normal text-stone-400">Nhấn để nhận gợi ý</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRequestAiSuggestion()}
                    disabled={aiSuggestion.loading}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-lotus/10 px-3 py-1.5 text-xs font-semibold text-lotus transition hover:bg-lotus/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {aiSuggestion.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {hasAiSuggestion ? "Gợi ý lại" : "Gợi ý"}
                  </button>
                </div>

                {aiPanelOpen && hasAiSuggestion && (
                  <div className="border-t border-sand/70 px-4 py-3 space-y-3 max-h-[400px] overflow-y-auto">
                    <p className="border-b border-sand/60 pb-2 text-[11px] uppercase tracking-wider text-stone-400">
                      {aiSuggestionTarget?.selected
                        ? "Dựa trên tin nhắn khách đang được trả lời"
                        : "Dựa trên tin nhắn mới nhất của khách"}
                    </p>
                    {aiSuggestionTarget && (
                      <p className="truncate rounded-lg border-l-2 border-lotus/60 bg-lotus/5 px-2 py-1 text-xs text-stone-600">
                        “{aiSuggestionTarget.content}”
                      </p>
                    )}
                    {aiSuggestion.loading ? (
                      <div className="flex items-center gap-2 text-sm text-stone-500 py-2">
                        <span className="inline-block w-4 h-4 border-2 border-lotus border-t-transparent rounded-full animate-spin" />
                        AI đang phân tích nhu cầu khách hàng...
                      </div>
                    ) : aiSuggestion.error ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-rose-600 py-2">
                        <span>{aiSuggestion.error}</span>
                        <button
                          type="button"
                          onClick={() => void handleRequestAiSuggestion()}
                          className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                          Thử lại
                        </button>
                      </div>
                    ) : aiSuggestion.topics.length === 0 ? (
                      <div className="text-sm text-stone-500 py-2">Không có gợi ý sản phẩm nào.</div>
                    ) : (
                      <div className="space-y-3">
                        {aiSuggestion.topics.map((topic, i) => (
                          <div
                            key={i}
                            className="rounded-xl border border-sand/70 bg-parchment p-4 space-y-3"
                          >
                            {/* Title + reason */}
                            <div>
                              <p className="text-sm font-semibold text-ink">
                                Gợi ý {i + 1}: {topic.title}
                              </p>
                            </div>

                            {/* Product previews */}
                            {topic.products.length > 0 && (
                              <div className="grid grid-cols-2 gap-2">
                                {topic.products.map((p) => (
                                  <div
                                    key={p.garmentId}
                                    className="flex gap-2 rounded-xl border border-sand/70 bg-white p-2 min-w-0"
                                  >
                                     {p.imageUrl ? (
                                      <img
                                        src={p.imageUrl}
                                        alt={p.name}
                                        className="w-12 h-12 rounded-lg object-cover border border-sand/70 shrink-0"
                                        onError={(e) => { e.currentTarget.src = DEFAULT_PRODUCT_IMAGE; }}
                                      />
                                    ) : (
                                      <div className="w-12 h-12 rounded-lg bg-sand/50 shrink-0 flex items-center justify-center text-stone-400 text-xs">
                                        📷
                                      </div>
                                    )}
                                    <div className="min-w-0 space-y-0.5 flex-1">
                                      <p className="text-xs font-semibold text-ink truncate">{p.name}</p>
                                      <p className="text-[11px] text-lotus font-semibold">{formatVND(p.dailyPrice)}</p>
                                      {p.size && <p className="text-[10px] text-stone-500">Size: {p.size}</p>}
                                      {p.reason && (
                                        <p className="text-[10px] text-stone-500 line-clamp-1">{p.reason}</p>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => void handleInsertProductCard(p.garmentId)}
                                        className="inline-flex items-center gap-1 rounded-full bg-jade/10 px-2 py-0.5 text-[10px] font-semibold text-jade transition hover:bg-jade/20 mt-1"
                                      >
                                        Gửi sản phẩm
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Reply preview */}
                            <div className="rounded-lg border border-sand/60 bg-white px-3 py-2">
                              <p className="text-[11px] uppercase tracking-wider text-stone-400 mb-1">
                                Tin nhắn sẽ gửi:
                              </p>
                              <p className="text-sm text-stone-700 leading-relaxed line-clamp-3">
                                {topic.assistantReply}
                              </p>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleInsertReply(topic.assistantReply)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-lotus/10 px-4 py-2 text-xs font-semibold text-lotus transition hover:bg-lotus/20"
                              >
                                <Sparkles className="h-3.5 w-3.5" /> Chèn câu trả lời này
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* AI Toast */}
            {aiToast && (
              <div className="rounded-lg bg-jade px-4 py-3 text-sm text-white shadow-lg shrink-0">
                {aiToast}
              </div>
            )}

            <div className="flex flex-col gap-3 shrink-0">
              {replyTarget && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-sand bg-parchment px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-lotus">
                      Trả lời {replyTarget.senderLabel}
                    </p>
                    <p className="line-clamp-2 break-words text-xs text-stone-600">
                      {replyTarget.content}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onCancelReply}
                    className="shrink-0 rounded-full p-1 text-stone-400 transition hover:bg-sand/60 hover:text-stone-600"
                    title="Huỷ trả lời"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="relative">
                <ChatTextarea
                  rows={4}
                  value={messageText}
                  onValueChange={(next) => {
                    if (!isUnassignedPreview && !managerSupportByOther) {
                      setMessageText(next);
                    }
                  }}
                  onFocus={() => {
                    if (!isUnassignedPreview && !managerSupportByOther && canReplyNow) onTyping(true);
                  }}
                  onBlur={() => {
                    if (!isUnassignedPreview && !managerSupportByOther) onTyping(false);
                  }}
                  onKeyDown={(e) => {
                    // Enter dùng để chốt chữ đang ghép của bộ gõ tiếng Việt
                    // không được kích hoạt gửi tin.
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      onSendMessage();
                    }
                  }}
                  disabled={isUnassignedPreview || managerSupportByOther || !canReplyNow}
                  className="min-h-[140px] w-full rounded-xl border border-sand bg-white px-4 py-3 pb-10 text-sm outline-none focus:border-lotus disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed"
                  placeholder={
                    isUnassignedPreview
                      ? "Tiếp nhận cuộc trò chuyện để trả lời..."
                      : managerSupportByOther
                        ? "Quản lý đang hỗ trợ hội thoại này..."
                        : !canReplyNow
                          ? "Chưa có quyền trả lời..."
                          : "Nhập tin nhắn..."
                  }
                />
                <div className="absolute bottom-2 left-3 flex items-center gap-1">
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
                    disabled={uploading || isUnassignedPreview || managerSupportByOther || !canReplyNow}
                    className="inline-flex items-center justify-center rounded-xl w-8 h-8 border border-sand bg-white text-stone-400 transition hover:bg-sand/50 hover:text-stone-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Đính kèm file"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin text-lotus" /> : <Paperclip className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={onSendMessage}
                  disabled={isUnassignedPreview || managerSupportByOther || !canReplyNow}
                  className={`inline-flex items-center gap-2 justify-center rounded-xl px-5 py-3 text-sm font-semibold text-white transition ${
                    isUnassignedPreview || managerSupportByOther || !canReplyNow
                      ? "bg-sand/70 cursor-not-allowed"
                      : "bg-lotus hover:bg-oxblood shadow-sm"
                  }`}
                >
                  <Send className="h-4 w-4" /> Gửi tin nhắn
                </button>
                {!isUnassignedPreview && !isResolved && !managerSupportActive && (
                  <button
                    type="button"
                    onClick={() => setShowResolveConfirm(true)}
                    className="inline-flex items-center justify-center rounded-lg border border-lotus px-5 py-3 text-sm font-semibold text-lotus hover:bg-lotus/10"
                  >
                    Đánh dấu đã tư vấn
                  </button>
                )}
              </div>
            </div>

            {typingEntries.length > 0 && (
              <div className="mt-4 rounded-lg bg-mist px-4 py-3 text-sm text-stone-600 shrink-0">
                {typingEntries.some((id) => id !== session?.user.id) ? "... Khách hàng đang nhập..." : "Bạn đang nhập..."}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-sand/70 bg-mist p-8 text-center text-sm text-stone-600">
            Chọn một cuộc trò chuyện để xem tin nhắn và khóa chat.
          </div>
        )}
      </section>

      {showResolveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-ink">Xác nhận</h3>
            <p className="mb-6 text-sm text-stone-600">
              Bạn có chắc chắn muốn đánh dấu cuộc trò chuyện này là đã tư vấn?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowResolveConfirm(false)}
                className="rounded-lg border border-sand px-4 py-2 text-sm text-stone-700 hover:bg-parchment"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResolveConfirm(false);
                  onResolveConversation();
                }}
                className="rounded-lg bg-lotus px-4 py-2 text-sm text-white hover:bg-red-800"
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}