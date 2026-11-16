import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { CreateExtensionLinkDto } from "./dto/create-extension-link.dto";
import { CreatePaymentLinkDto } from "./dto/create-payment-link.dto";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("create-link")
  @UseGuards(JwtAuthGuard)
  createPaymentLink(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePaymentLinkDto,
  ) {
    return this.paymentsService.createPaymentLink(body.bookingId, user.id);
  }

  /** Khách gia hạn đơn thuê: giữ lịch + tạo link PayOS cho phí gia hạn. */
  @Post("extension-link")
  @UseGuards(JwtAuthGuard)
  createExtensionLink(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateExtensionLinkDto,
  ) {
    return this.paymentsService.createExtensionPaymentLink(body.bookingId, user.id, body.days);
  }

  @Get("extensions/:extensionId/status")
  @UseGuards(JwtAuthGuard)
  getExtensionStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("extensionId", ParseUUIDPipe) extensionId: string,
  ) {
    return this.paymentsService.getExtensionStatus(extensionId, user);
  }

  /** Poll trạng thái thanh toán phần chênh của yêu cầu đổi mẫu/bỏ món (§13.2). */
  @Get("change-requests/:requestId/status")
  @UseGuards(JwtAuthGuard)
  getChangeRequestStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.paymentsService.getChangeRequestStatus(requestId, user);
  }

  /**
   * Cấp lại link PayOS cho yêu cầu đổi khi khách đã huỷ ở cổng thanh toán
   * (orderCode cũ không tái sử dụng được).
   */
  @Post("change-requests/:requestId/retry")
  @UseGuards(JwtAuthGuard)
  retryChangeRequestPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.paymentsService.retryChangeRequestPayment(requestId, user);
  }

  @Post("webhook")
  handleWebhook(@Body() body: any) {
    return this.paymentsService.handleWebhook(body);
  }

  @Get(":bookingId/status")
  @UseGuards(JwtAuthGuard)
  getPaymentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("bookingId", ParseUUIDPipe) bookingId: string,
  ) {
    return this.paymentsService.getPaymentStatus(bookingId, user);
  }
}
