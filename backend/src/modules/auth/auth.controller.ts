import { AppRole } from "@prisma/client";
import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AuthenticatedUser } from "./auth-user";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Roles } from "./decorators/roles.decorator";
import { LoginDto } from "./dto/login.dto";
import { GoogleLoginDto } from "./dto/google-login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResendOtpDto } from "./dto/resend-otp.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { AuthService } from "./auth.service";

// [SECURITY FIX] Giới hạn nghiêm ngặt cho toàn bộ AuthController:
// 5 requests / 1 phút / IP — ngăn brute-force mật khẩu và spam OTP
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Throttle(AUTH_THROTTLE)
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post("verify-email")
  @Throttle(AUTH_THROTTLE)
  verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body);
  }

  @Post("resend-otp")
  @Throttle(AUTH_THROTTLE)
  resendOtp(@Body() body: ResendOtpDto) {
    return this.authService.resendVerificationCode(body.email);
  }

  @Post("forgot-password")
  @Throttle(AUTH_THROTTLE)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body);
  }

  @Post("reset-password")
  @Throttle(AUTH_THROTTLE)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }

  @Post("google")
  @Throttle(AUTH_THROTTLE)
  google(@Body() body: GoogleLoginDto) {
    return this.authService.loginWithGoogle(body);
  }

  @Post("login")
  @Throttle(AUTH_THROTTLE)
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.customer, AppRole.staff, AppRole.manager_owner, AppRole.admin)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }
}
