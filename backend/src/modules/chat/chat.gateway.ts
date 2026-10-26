import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect, WebSocketServer } from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { AppRole } from "@prisma/client";
import type { Server, Socket } from "socket.io";
import { ChatService } from "./chat.service";
import { PrismaService } from "../../prisma/prisma.service";

interface JwtPayload {
  sub?: string;
  role?: AppRole;
}

interface AuthSocket extends Socket {
  data: {
    user?: {
      userId: string;
      role: AppRole;
      fullName: string;
    };
  };
}

interface ActiveReplier {
  staffId: string;
  name: string;
  socketId: string;
  lockedAt: Date;
}

// Sau khi lock staff hết hạn, chờ một khoảng ngắn để staff khác kịp nhận
// hội thoại trước khi AI trả lời tin cuối của khách.
const POST_RELEASE_AI_DELAY_MS = 20_000;

// Số phút staff giữ quyền trả lời một hội thoại trước khi lock tự hết hạn.
// Có thể đổi trong backend/.env mà không cần sửa code:
//   CHAT_STAFF_LOCK_TIMEOUT_MINUTES=30
const DEFAULT_STAFF_LOCK_TIMEOUT_MINUTES = 20;

// Đọc tại thời điểm dùng (không phải lúc import module) để chắc chắn
// ConfigModule đã nạp backend/.env xong.
export function getStaffLockTimeoutMs(): number {
  const configured = Number(process.env.CHAT_STAFF_LOCK_TIMEOUT_MINUTES);
  const minutes =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_STAFF_LOCK_TIMEOUT_MINUTES;
  return minutes * 60 * 1000;
}

@WebSocketGateway({
  namespace: "/chat",
  cors: {
    origin: true,
    credentials: true,
  },
})
@Injectable()
export class ChatGateway implements OnModuleInit, OnModuleDestroy, OnGatewayConnection, OnGatewayDisconnect {

  async onModuleInit() {
    // Server restart — in-memory timers are gone
    await this.chatService.resolveAllReopenedConversations();
    await this.chatService.releaseStaleStaffAssignments();
    this.rateLimitCleanupInterval = setInterval(() => this.cleanupRateLimits(), ChatGateway.RATE_LIMIT_WINDOW_MS);
  }

  onModuleDestroy() {
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
    }
    for (const timeout of this.postReleaseAiTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.postReleaseAiTimeouts.clear();
  }
  @WebSocketServer()
  server!: Server;

  private readonly onlineUsers = new Map<string, Set<string>>();
  private readonly activeReplier = new Map<string, ActiveReplier>();
  private readonly lockTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly disconnectReleaseTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly postReleaseAiTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly messageRateLimits = new Map<string, number[]>();
  private rateLimitCleanupInterval?: NodeJS.Timeout;
  private readonly aiReplyCounters = new Map<string, number>();
  private static readonly MAX_MESSAGE_LENGTH = 2000;
  private static readonly RATE_LIMIT_MAX = 5;
  private static readonly RATE_LIMIT_WINDOW_MS = 10_000;

  private isProductCardPayload(content: string): boolean {
    try {
      const parsed = JSON.parse(content);
      return parsed?.type === "product_card" || parsed?.type === "booking_card";
    } catch {
      return false;
    }
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const timestamps = this.messageRateLimits.get(userId) ?? [];
    const recent = timestamps.filter((ts) => now - ts < ChatGateway.RATE_LIMIT_WINDOW_MS);
    if (recent.length >= ChatGateway.RATE_LIMIT_MAX) {
      return false;
    }
    recent.push(now);
    this.messageRateLimits.set(userId, recent);
    return true;
  }

  private cleanupRateLimits() {
    const now = Date.now();
    for (const [userId, timestamps] of this.messageRateLimits) {
      const recent = timestamps.filter((ts) => now - ts < ChatGateway.RATE_LIMIT_WINDOW_MS);
      if (recent.length === 0) {
        this.messageRateLimits.delete(userId);
      } else {
        this.messageRateLimits.set(userId, recent);
      }
    }
  }

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthSocket) {
    const token = this.getTokenFromHandshake(client);
    if (!token) {
      client.disconnect();
      return;
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      client.disconnect();
      return;
    }

    if (!payload?.sub || !payload?.role) {
      client.disconnect();
      return;
    }

    const user = await this.prisma.userAccount.findUnique({
      where: { id: payload.sub },
      include: { profile: true },
    });

    if (!user || !user.isActive) {
      client.disconnect();
      return;
    }

    const fullName = user.profile?.fullName ?? user.email;
    const dbRole = user.role;
    client.data.user = {
      userId: user.id,
      role: dbRole,
      fullName,
    };

    let userSockets = this.onlineUsers.get(user.id);
    const isNewStaff = this.isStaffSide(dbRole) && (!userSockets || userSockets.size === 0);
    if (!userSockets) {
      userSockets = new Set();
      this.onlineUsers.set(user.id, userSockets);
    }
    userSockets.add(client.id);
    if (isNewStaff) {
      this.onlineStaffCount++;
      //console.log("CONNECT staff", client.id, user.id, "onlineStaffCount:", this.onlineStaffCount, "totalSockets:", userSockets.size);
    }
    if (this.isStaffSide(dbRole)) {
      client.join("staff");
    } else {
      client.join("customers");
    }

    // Auto-join user to their active conversation rooms
    try {
      const convs = await this.prisma.conversations.findMany({
        where: this.isStaffSide(dbRole)
          ? { staff_id: user.id, status: { in: ["open", "resolved"] } }
          : { customer_id: user.id, status: { in: ["open", "resolved"] } },
        select: { id: true },
      });
      for (const c of convs) {
        client.join(c.id);
        //console.log("JOIN (auto-connect)", client.id, c.id);
      }
    } catch {
      // Non-critical — room join is just pub/sub routing
    }
  }

  hasOnlineStaff(): boolean {
    return this.onlineStaffCount > 0;
  }

  // Staff và Quản lý/Chủ cửa hàng đều thao tác phía "nhân viên" trong chat
  // (manager cần chat với khách để xin thông tin chuyển khoản hoàn cọc).
  private isStaffSide(role?: string): boolean {
    return role === "staff" || role === "manager_owner";
  }

  private onlineStaffCount = 0;

  handleDisconnect(client: AuthSocket) {
    const user = client.data.user;
    if (!user) {
      //console.log("DISCONNECT no user", client.id);
      return;
    }

    const userSockets = this.onlineUsers.get(user.userId);
    const remaining = userSockets ? (userSockets.delete(client.id), userSockets.size) : 0;
    if (remaining === 0) {
      this.onlineUsers.delete(user.userId);
    }
    //console.log("DISCONNECT", client.id, user.userId, user.role, "remainingSockets:", remaining);

    if (this.isStaffSide(user.role)) {
      if (remaining === 0) {
        this.onlineStaffCount--;
        //console.log("DISCONNECT staff last socket, onlineStaffCount:", this.onlineStaffCount);
      }
      this.scheduleStaffDisconnectRelease(client.id, user.userId);
    }
  }

  @SubscribeMessage("join_room")
  async handleJoinRoom(@MessageBody() body: { conversationId: string }, @ConnectedSocket() client: AuthSocket) {
    if (!body?.conversationId) {
      return;
    }

    const user = client.data.user;
    if (!user) {
      return;
    }

    try {
      await this.chatService.ensureCustomerOrStaffParticipant({
        id: user.userId,
        email: "",
        role: user.role,
        isActive: true,
        fullName: user.fullName,
        phone: null,
      }, body.conversationId);
    } catch {
      // Room join is pub/sub routing — auth is at message level
    }

    client.join(body.conversationId);
    //console.log("JOIN ROOM SUCCESS", client.id, body.conversationId, Array.from(client.rooms));
  }

  @SubscribeMessage("open_conversation")
  async handleOpenConversation(@MessageBody() body: { conversationId: string }, @ConnectedSocket() client: AuthSocket) {
    const user = client.data.user;
    if (!user || !this.isStaffSide(user.role) || !body?.conversationId) {
      client.emit("open_conversation_result", { conversationId: body?.conversationId, canReply: false, reason: "unauthorized" });
      return;
    }

    let conversation;
    try {
      conversation = await this.chatService.getConversationById(body.conversationId);
    } catch {
      client.emit("open_conversation_result", { conversationId: body.conversationId, canReply: false, reason: "not_found" });
      return;
    }

    let existingLock = this.activeReplier.get(body.conversationId);

    // Tài khoản được gán không còn tồn tại hoặc đã bị vô hiệu hoá (mất acc,
    // admin khoá tài khoản): trả hội thoại về "Chờ tiếp nhận" ngay, bất kể
    // tin cuối là của ai, để staff khác có thể mở và tiếp tục hỗ trợ.
    if (conversation.staff_id && conversation.staff_id !== user.userId) {
      const unavailable = await this.chatService.releaseAssignmentIfStaffUnavailable(
        body.conversationId,
        conversation.staff_id,
      );
      if (unavailable) {
        const staleLock = this.activeReplier.get(body.conversationId);
        if (staleLock?.staffId === conversation.staff_id) {
          this.clearActiveLock(body.conversationId);
          this.clearDisconnectReleaseForSocket(staleLock.socketId);
          existingLock = undefined;
        }
        conversation = await this.chatService.getConversationById(body.conversationId);
      }
    }

    // Zombie lock: DB has staff_id but in-memory lock is gone (e.g. server
    // restart). The assignment is stale even if staff sent the last message;
    // release it so the conversation can move to "Chờ khách" and be picked up.
    // Don't clear reopened conversations — keep original staff assigned.
    if (conversation.staff_id && conversation.staff_id !== user.userId && !existingLock && !conversation.reopened_from_resolved) {
      const released = await this.chatService.releaseStaffAssignmentIfStale(body.conversationId, conversation.staff_id);
      if (released) {
        conversation = await this.chatService.getConversationById(body.conversationId);
      }
    }

    // Reopen resolved conversation when staff clicks it
    if (conversation.status === "resolved") {
      if (conversation.staff_id && conversation.staff_id !== user.userId) {
        client.emit("open_conversation_result", { conversationId: body.conversationId, canReply: false, lockedBy: "staff cũ" });
        return;
      }
      conversation = await this.chatService.reopenConversation(body.conversationId, user.userId);
    }

    if (conversation.staff_id && conversation.staff_id !== user.userId) {
      client.emit("open_conversation_result", { conversationId: body.conversationId, canReply: false, lockedBy: "nhân viên khác" });
      return;
    }

    if (!conversation.staff_id) {
      conversation = await this.chatService.assignStaffToConversationIfEmpty(body.conversationId, user.userId);
      if (conversation.staff_id !== user.userId) {
        client.emit("open_conversation_result", { conversationId: body.conversationId, canReply: false, lockedBy: "nhân viên khác" });
        return;
      }
    }

    // Staff đã nhận hội thoại trong khoảng chờ → huỷ lượt AI sau release.
    this.clearPostReleaseAiTimer(body.conversationId);

    if (existingLock?.staffId === user.userId) {
      this.clearDisconnectReleaseForSocket(existingLock.socketId);
    }
    this.clearDisconnectReleaseForSocket(client.id);

    const lockInfo: ActiveReplier = {
      staffId: user.userId,
      name: user.fullName,
      socketId: client.id,
      lockedAt: existingLock?.staffId === user.userId ? existingLock.lockedAt : new Date(),
    };

    this.activeReplier.set(body.conversationId, lockInfo);
    if (!existingLock || existingLock.staffId !== user.userId) {
      this.scheduleLockExpiration(body.conversationId);
    }

    // Staff vừa nhận → tắt indicator AI nếu một lượt auto-reply cũ đang chờ.
    this.emitAiTyping(body.conversationId, false);

    client.emit("open_conversation_result", {
      conversationId: body.conversationId,
      canReply: true,
      staffId: user.userId,
      staffName: user.fullName,
      status: conversation.status,
    });
    client.broadcast.to("staff").emit("chat_locked", {
      conversationId: body.conversationId,
      staffName: user.fullName,
    });
  }

  @SubscribeMessage("delete_message")
  async handleDeleteMessage(
    @MessageBody() body: { conversationId: string; messageId: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    const user = client.data.user;
    if (!user || !body?.conversationId || !body?.messageId) {
      return;
    }

    // Staff chỉ được xoá tin của mình khi đang giữ lock trả lời của hội thoại.
    // Khách vẫn xoá được tin của khách mà không cần lock.
    if (this.isStaffSide(user.role) && !this.isStaffLockActive(body.conversationId, user.userId)) {
      client.emit("delete_error", {
        conversationId: body.conversationId,
        messageId: body.messageId,
        reason: "lock_required",
      });
      return;
    }

    try {
      const result = await this.chatService.deleteMessage(
        user.userId,
        body.messageId,
        body.conversationId,
      );
      this.server.to(body.conversationId).emit("message_deleted", {
        conversationId: body.conversationId,
        messageId: body.messageId,
        deletedBy: user.userId,
        deletedAt: result.deleted_at,
      });
    } catch {
      client.emit("delete_error", { conversationId: body.conversationId, messageId: body.messageId, reason: "cannot_delete" });
    }
  }

  @SubscribeMessage("send_message")
  async handleSendMessage(
    @MessageBody() body: { conversationId: string; content: string; tempId?: string },
    @ConnectedSocket() client: AuthSocket,
  ): Promise<{ success: boolean; error?: string; tempId?: string }> {
    const user = client.data.user;
    if (!user || !body?.conversationId || !body?.content?.trim()) {
      return { success: false, error: "invalid_payload" };
    }

    const content = body.content.trim();

    // Validate message length (max 2000 characters)
    if (content.length > ChatGateway.MAX_MESSAGE_LENGTH) {
      client.emit("send_error", {
        conversationId: body.conversationId,
        reason: "message_too_long",
        tempId: body.tempId,
      });
      return { success: false, error: "message_too_long" };
    }

    // Reject direct client attempts to send product_card payloads
    if (this.isProductCardPayload(content)) {
      client.emit("send_error", {
        conversationId: body.conversationId,
        reason: "forbidden_payload",
        tempId: body.tempId,
      });
      return { success: false, error: "forbidden_payload" };
    }

    // Rate limiting: max 5 messages per 10 seconds per user
    if (!this.checkRateLimit(user.userId)) {
      client.emit("send_error", {
        conversationId: body.conversationId,
        reason: "rate_limited",
        tempId: body.tempId,
      });
      return { success: false, error: "rate_limited" };
    }

    if (this.isStaffSide(user.role)) {
      const conversation = await this.chatService.getConversationById(body.conversationId);
      if (conversation.staff_id !== user.userId) {
        client.emit("send_error", { conversationId: body.conversationId, reason: "conversation_locked", tempId: body.tempId });
        return { success: false, error: "conversation_locked" };
      }

      this.clearPostReleaseAiTimer(body.conversationId);
      this.activeReplier.set(body.conversationId, {
        staffId: user.userId,
        name: user.fullName,
        socketId: client.id,
        lockedAt: new Date(),
      });
      this.scheduleLockExpiration(body.conversationId);
    }

    const message = await this.chatService.sendMessage(user.userId, user.role, body.conversationId, body.content);

    const updatedConv = await this.prisma.conversations.findUnique({
      where: { id: body.conversationId },
      select: { staff_id: true, status: true },
    });
    if (!client.rooms.has(body.conversationId)) {
      client.join(body.conversationId);
    }
    this.server.to(body.conversationId).emit("message_received", {
      conversationId: body.conversationId,
      message,
      staffId: updatedConv?.staff_id ?? null,
      status: updatedConv?.status ?? "open",
    });

    if (user.role === "customer") {
      if (updatedConv && !updatedConv.staff_id && updatedConv.status === "open") {
        this.server.to("staff").emit("new_unassigned_message", {
          conversationId: body.conversationId,
          customerName: user.fullName,
          content: body.content,
        });
      }

      const convId = body.conversationId;
      const counter = (this.aiReplyCounters.get(convId) ?? 0) + 1;
      this.aiReplyCounters.set(convId, counter);
      const currentCounter = counter;

      const isCurrentReply = () => this.aiReplyCounters.get(convId) === currentCounter;

      // Staff đã nhận hội thoại (dù chưa gửi tin) → không để AI chen ngang.
      // Vẫn tăng counter ở trên để vô hiệu callback AI cũ nếu có.
      if (!this.hasActiveStaffLock(convId)) {
        void this.chatService.maybeAutoReply(
          convId,
          { content: body.content, messageType: "text", messageId: message.id },
          {
            // Chỉ hiện "AI đang nhập" khi tin này thực sự được đưa vào hàng đợi
            // (không phải tin rỗng/emoji hay hội thoại đang có staff xử lý).
            onAccepted: () => {
              if (!isCurrentReply()) return;
              this.emitAiTyping(convId, true);
            },
            // Staff có thể nhận hội thoại trong lúc debounce/model đang chạy.
            shouldAbort: () => this.hasActiveStaffLock(convId),
          },
        ).then(async (aiMsgs) => {
          if (!isCurrentReply()) return;
          this.emitAiTyping(convId, false);
          if (aiMsgs.length === 0) return;

          // Giữ đúng assignment hiện tại trong payload. Trước đây hardcode
          // staffId=null làm UI tưởng hội thoại vừa bị nhả và hiện lại nút nhận.
          const aiConv = await this.prisma.conversations.findUnique({
            where: { id: convId },
            select: { staff_id: true, status: true },
          });
          for (const aiMsg of aiMsgs) {
            this.server.to(convId).emit("message_received", {
              conversationId: convId,
              message: aiMsg,
              staffId: aiConv?.staff_id ?? null,
              status: aiConv?.status ?? "open",
            });
          }
        }).catch(() => {
          // Không để typing indicator treo nếu auto-reply ném lỗi ngoài dự kiến.
          if (!isCurrentReply()) return;
          this.emitAiTyping(convId, false);
        });
      } else {
        // Lock hiện tại đã vô hiệu callback AI cũ; tắt indicator ngay.
        this.emitAiTyping(convId, false);
      }
    }

    return { success: true, tempId: body.tempId };
  }

  @SubscribeMessage("resolve_conversation")
  async handleResolveConversation(@MessageBody() body: { conversationId: string }, @ConnectedSocket() client: AuthSocket) {
    const user = client.data.user;
    if (!user || !this.isStaffSide(user.role) || !body?.conversationId) {
      return;
    }

    try {
      const conversation = await this.chatService.resolveConversation(body.conversationId, user.userId);
      this.clearActiveLock(body.conversationId);
      this.server.to(body.conversationId).emit("conversation_resolved", {
        conversationId: body.conversationId,
        status: conversation.status,
      });
      this.server.to("staff").emit("chat_unlocked", { conversationId: body.conversationId, status: conversation.status });
    } catch {
      client.emit("resolve_error", { conversationId: body.conversationId, reason: "cannot_resolve" });
    }
  }

  @SubscribeMessage("read_conversation")
  async handleReadConversation(
    @MessageBody() body: { conversationId: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    const user = client.data.user;
    if (!user || !body?.conversationId) {
      return;
    }

    await this.chatService.markConversationRead(user.userId, user.role, body.conversationId);
    this.server.to(body.conversationId).emit("conversation_read", {
      conversationId: body.conversationId,
      readerId: user.userId,
    });
  }

  @SubscribeMessage("typing")
  async handleTyping(
    @MessageBody() body: { conversationId: string; isTyping: boolean },
    @ConnectedSocket() client: AuthSocket,
  ) {
    const user = client.data.user;
    if (!user || !body?.conversationId || typeof body.isTyping !== "boolean") {
      return;
    }

    client.to(body.conversationId).emit("typing", {
      conversationId: body.conversationId,
      isTyping: body.isTyping,
      userId: user.userId,
    });
  }

  emitAiTyping(conversationId: string, isTyping: boolean) {
    this.server?.to(conversationId).emit("typing", {
      conversationId,
      isTyping,
      userId: "ai-assistant",
    });
  }

  /**
   * Staff đang giữ lock trả lời (đã nhận hội thoại nhưng có thể chưa gửi tin).
   * Auto-reply phải dừng để không chen ngang.
   */
  hasActiveStaffLock(conversationId: string): boolean {
    return this.activeReplier.has(conversationId);
  }

  /**
   * Dùng cho REST danh sách/đếm tab: chỉ coi là "Chờ phản hồi" khi đúng staff
   * đang giữ lock và lock chưa quá CHAT_STAFF_LOCK_TIMEOUT_MINUTES.
   */
  isStaffLockActive(conversationId: string, staffId: string): boolean {
    const activeLock = this.activeReplier.get(conversationId);
    if (!activeLock || activeLock.staffId !== staffId) return false;
    return Date.now() < activeLock.lockedAt.getTime() + getStaffLockTimeoutMs();
  }

  getLockStatus(conversationId: string) {
    const activeLock = this.activeReplier.get(conversationId);
    if (!activeLock) {
      return {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
        expiresAt: null,
      };
    }

    const expiresAt = new Date(activeLock.lockedAt.getTime() + getStaffLockTimeoutMs());
    return {
      isLocked: true,
      lockedBy: { staffId: activeLock.staffId, name: activeLock.name },
      lockedAt: activeLock.lockedAt,
      expiresAt,
    };
  }

  private scheduleStaffDisconnectRelease(socketId: string, staffId: string) {
    const existing = this.disconnectReleaseTimeouts.get(socketId);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(() => {
      this.disconnectReleaseTimeouts.delete(socketId);
      this.releaseStaffLocksBySocket(socketId);
      const hasOnline = this.onlineUsers.has(staffId);
      //console.log("TIMER FIRE", socketId, staffId, "onlineUsers.has?", hasOnline);
      if (!hasOnline) {
        //console.log("CLEAR DB staff_id for", staffId);
        void this.chatService.autoReplyReleasedConversations(staffId).then((results) => {
          for (const { conversationId, messages: aiMsgs } of results) {
            this.emitAiMessages(conversationId, aiMsgs);
          }
        });
      }
    }, 30 * 1000);
    this.disconnectReleaseTimeouts.set(socketId, timeout);
  }

  private clearDisconnectReleaseForSocket(socketId: string) {
    const timeout = this.disconnectReleaseTimeouts.get(socketId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.disconnectReleaseTimeouts.delete(socketId);
  }

  private releaseStaffLocksBySocket(socketId: string) {
    const locksToRelease = Array.from(this.activeReplier.entries())
      .filter(([, lock]) => lock.socketId === socketId)
      .map(([conversationId]) => conversationId);

    locksToRelease.forEach((conversationId) => this.releaseLock(conversationId));
  }

  private clearActiveLock(conversationId: string) {
    this.activeReplier.delete(conversationId);
    const timeout = this.lockTimeouts.get(conversationId);
    if (timeout) {
      clearTimeout(timeout);
      this.lockTimeouts.delete(conversationId);
    }
  }

  private releaseLock(conversationId: string, options?: { scheduleAi?: boolean }) {
    const lock = this.activeReplier.get(conversationId);
    if (!lock) {
      return;
    }

    this.clearActiveLock(conversationId);

    void this.chatService.releaseConversationLock(conversationId, lock.staffId).then((result) => {
      const { status, released } = result;
      this.server?.to("staff").emit("chat_unlocked", { conversationId, status, released });

      // Chỉ AI trả lời khi lock thực sự nhả assignment và hội thoại còn mở.
      // Chờ một khoảng ngắn để staff khác kịp nhận trước khi AI chen vào.
      if (options?.scheduleAi && released && status === "open") {
        this.schedulePostReleaseAutoReply(conversationId);
      }
    });
  }

  private schedulePostReleaseAutoReply(conversationId: string) {
    this.clearPostReleaseAiTimer(conversationId);

    const timeout = setTimeout(() => {
      this.postReleaseAiTimeouts.delete(conversationId);
      void this.chatService
        .autoReplyUnassignedIfCustomerWaiting(conversationId)
        .then((aiMsgs) => this.emitAiMessages(conversationId, aiMsgs))
        .catch(() => undefined);
    }, POST_RELEASE_AI_DELAY_MS);

    this.postReleaseAiTimeouts.set(conversationId, timeout);
  }

  private clearPostReleaseAiTimer(conversationId: string) {
    const timeout = this.postReleaseAiTimeouts.get(conversationId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.postReleaseAiTimeouts.delete(conversationId);
  }

  private emitAiMessages(conversationId: string, aiMsgs: Array<{ id: string }>) {
    for (const aiMsg of aiMsgs) {
      this.server?.to(conversationId).emit("message_received", {
        conversationId,
        message: aiMsg,
        staffId: null,
        status: "open",
      });
    }
  }

  private scheduleLockExpiration(conversationId: string) {
    const existingTimeout = this.lockTimeouts.get(conversationId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      const lock = this.activeReplier.get(conversationId);
      if (!lock) {
        return;
      }

      this.releaseLock(conversationId, { scheduleAi: true });
      if (this.server) {
        const holdingSocket = this.server.sockets?.sockets?.get?.(lock.socketId) ?? null;
        if (holdingSocket) {
          holdingSocket.emit("lock_expired", { conversationId });
        }
      }
    }, getStaffLockTimeoutMs());

    this.lockTimeouts.set(conversationId, timeout);
  }

  private getTokenFromHandshake(client: Socket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string" && authToken.trim().length > 0) {
      return authToken.replace(/^Bearer\s+/i, "").trim();
    }

    const authorizationHeader = client.handshake.headers?.authorization as string | undefined;
    if (!authorizationHeader) {
      return undefined;
    }

    const [scheme, token] = authorizationHeader.trim().split(" ");
    if (scheme !== "Bearer" || !token) {
      return undefined;
    }

    return token;
  }
}