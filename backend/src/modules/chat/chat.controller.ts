import { Body, Controller, DefaultValuePipe, ForbiddenException, Get, Logger, ParseIntPipe, ParseUUIDPipe, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors, MaxFileSizeValidator, ParseFilePipe, FileTypeValidator } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth-user";
import { ChatService } from "./chat.service";
import { ChatGateway } from "./chat.gateway";
import type { AutoReplyTrigger } from "./auto-reply-policy";
import { ok } from "../../common/api-response";

@Controller("chat")
@UseGuards(JwtAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Chạy auto-reply cho các tin không đi qua socket (product card, booking card,
   * ảnh/video) rồi phát kết quả cho phòng chat.
   */
  private async runAutoReply(conversationId: string, trigger: AutoReplyTrigger) {
    // Staff đang giữ quyền trả lời, kể cả chưa gửi tin → AI không chen ngang.
    if (this.chatGateway.hasActiveStaffLock(conversationId)) return;

    let accepted = false;

    try {
      const aiMsgs = await this.chatService.maybeAutoReply(conversationId, trigger, {
        onAccepted: () => {
          accepted = true;
          this.chatGateway.emitAiTyping(conversationId, true);
        },
        shouldAbort: () => this.chatGateway.hasActiveStaffLock(conversationId),
      });

      if (aiMsgs.length === 0) return;

      // Giữ đúng assignment hiện tại thay vì luôn gửi null.
      const current = await this.chatService.getConversationById(conversationId);
      for (const aiMsg of aiMsgs) {
        this.chatGateway.server?.to(conversationId).emit("message_received", {
          conversationId,
          message: aiMsg,
          staffId: current.staff_id ?? null,
          status: current.status,
        });
      }
    } catch (error) {
      this.logger.error(
        `Auto-reply failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // Chỉ tắt indicator nếu chính request này đã bật nó.
      if (accepted) {
        this.chatGateway.emitAiTyping(conversationId, false);
      }
    }
  }

  @Get("conversations/counts")
  async getConversationCounts(@CurrentUser() user: AuthenticatedUser) {
    return ok(
      await this.chatService.getConversationCounts(user, (conversationId, staffId) =>
        this.chatGateway.isStaffLockActive(conversationId, staffId),
      ),
    );
  }

  @Get("conversations")
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query("tab") tab?: string,
  ) {
    return ok(
      await this.chatService.listConversations(user, tab, (conversationId, staffId) =>
        this.chatGateway.isStaffLockActive(conversationId, staffId),
      ),
    );
  }

  @Get("conversations/me")
  async getMyConversation(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== "customer") {
      throw new ForbiddenException("Only customers can access their own chat conversation this way.");
    }

    return ok(await this.chatService.getOrCreateConversationForCustomer(user.id));
  }

  @Get("conversations/with-customer/:customerId")
  async getConversationWithCustomer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ) {
    return ok(await this.chatService.getOrCreateConversationWithCustomer(user, customerId));
  }

  @Get("conversations/:id/messages")
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Query("before") before?: string,
    @Query("limit", new DefaultValuePipe(15), ParseIntPipe) limit = 15,
  ) {
    return ok(await this.chatService.getMessages(user, conversationId, before, limit));
  }

  @Get("conversations/:id/lock-status")
  async getLockStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    const conversation = await this.chatService.getConversationById(conversationId);
    if (user.role === "customer") {
      if (conversation.customer_id !== user.id) {
        throw new ForbiddenException("You do not have permission to view lock status for this conversation.");
      }
    }

    return ok(this.chatGateway.getLockStatus(conversationId));
  }

  @Patch("conversations/:id/read")
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return ok(await this.chatService.markConversationRead(user.id, user.role, conversationId));
  }

  @Post("conversations/:id/product-card")
  async sendProductCard(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Body() body: { garmentId: string },
  ) {
    if (!body?.garmentId) {
      throw new ForbiddenException("garmentId is required.");
    }

    const [message, updatedConv] = await Promise.all([
      this.chatService.sendProductCardMessage(user.id, user.role, conversationId, body.garmentId),
      this.chatService.getConversationById(conversationId),
    ]);

    this.chatGateway.server?.to(conversationId).emit("message_received", {
      conversationId,
      message,
      staffId: updatedConv.staff_id,
      status: updatedConv.status,
    });

    if (user.role === "customer") {
      if (!updatedConv.staff_id && updatedConv.status === "open") {
        this.chatGateway.server?.to("staff").emit("new_unassigned_message", {
          conversationId,
          customerName: user.fullName,
          content: message?.content ?? "",
        });
      }

      // Trigger AI auto-reply for product card clicks (C6)
      void this.runAutoReply(conversationId, {
        content: "",
        messageType: "product_card",
        metadata: message?.metadata as Record<string, unknown> | null,
        messageId: message?.id,
      });
    }

    return ok(message);
  }

  @Post("conversations/:id/booking-card")
  async sendBookingCard(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Body() body: { bookingId: string; topic: string },
  ) {
    if (!body?.bookingId) {
      throw new ForbiddenException("bookingId is required.");
    }
    if (body?.topic !== "booking_support" && body?.topic !== "complaint") {
      throw new ForbiddenException("topic must be 'booking_support' or 'complaint'.");
    }

    const [message, updatedConv] = await Promise.all([
      this.chatService.sendBookingCardMessage(user.id, user.role, conversationId, body.bookingId, body.topic),
      this.chatService.getConversationById(conversationId),
    ]);

    this.chatGateway.server?.to(conversationId).emit("message_received", {
      conversationId,
      message,
      staffId: updatedConv.staff_id,
      status: updatedConv.status,
    });

    if (user.role === "customer") {
      if (!updatedConv.staff_id && updatedConv.status === "open") {
        this.chatGateway.server?.to("staff").emit("new_unassigned_message", {
          conversationId,
          customerName: user.fullName,
          content: message?.content ?? "",
        });
      }

      // Booking card/complaint luôn được policy xử lý cố định (không gọi model)
      // để khách nhận phản hồi ngay và staff nhận đúng ngữ cảnh.
      void this.runAutoReply(conversationId, {
        content: "",
        messageType: "booking_card",
        metadata: message?.metadata as Record<string, unknown> | null,
        messageId: message?.id,
      });
    }

    return ok(message);
  }

  @Post("conversations/:id/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: "^(image/|video/)" }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const [message, updatedConv] = await Promise.all([
      this.chatService.uploadFile(user.id, user.role, conversationId, file),
      this.chatService.getConversationById(conversationId),
    ]);

    this.chatGateway.server?.to(conversationId).emit("message_received", {
      conversationId,
      message,
      staffId: updatedConv.staff_id,
      status: updatedConv.status,
    });

    if (user.role === "customer") {
      if (!updatedConv.staff_id && updatedConv.status === "open") {
        this.chatGateway.server?.to("staff").emit("new_unassigned_message", {
          conversationId,
          customerName: user.fullName,
          content: message?.content ?? "",
        });
      }

      // AI không đọc được nội dung ảnh/video: trả lời cố định để khách biết
      // đã nhận media, hoặc chuyển staff nếu hội thoại đang là đơn hàng/khiếu nại.
      void this.runAutoReply(conversationId, {
        content: "",
        messageType: message?.message_type ?? "image",
        metadata: message?.metadata as Record<string, unknown> | null,
        messageId: message?.id,
      });
    }

    return ok(message);
  }
}

