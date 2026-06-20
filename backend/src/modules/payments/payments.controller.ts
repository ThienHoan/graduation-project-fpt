import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
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
    @Body("bookingId") bookingId: string,
  ) {
    return this.paymentsService.createPaymentLink(bookingId, user.id);
  }

  @Post("webhook")
  handleWebhook(@Body() body: any) {
    return this.paymentsService.handleWebhook(body);
  }

  @Get(":bookingId/status")
  @UseGuards(JwtAuthGuard)
  getPaymentStatus(@Param("bookingId", ParseUUIDPipe) bookingId: string) {
    return this.paymentsService.getPaymentStatus(bookingId);
  }
}
