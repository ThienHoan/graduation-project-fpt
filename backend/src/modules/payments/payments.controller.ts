import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
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
