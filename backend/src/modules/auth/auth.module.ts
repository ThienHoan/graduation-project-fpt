import { forwardRef, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { NotificationsModule } from "../notifications/notifications.module";
import { RedisModule } from "../redis/redis.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "./guards/optional-jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { AuthTokenService } from "./services/auth-token.service";
import { AuthLockoutService } from "./services/auth-lockout.service";
import { AuthOtpService } from "./services/auth-otp.service";
import { AuthPasswordService } from "./services/auth-password.service";
import { AuthAuditService } from "./services/auth-audit.service";

@Module({
  imports: [
    forwardRef(() => NotificationsModule),
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET") ?? "dev-secret-change-me",
        signOptions: { expiresIn: "7d" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenService,
    AuthLockoutService,
    AuthOtpService,
    AuthPasswordService,
    AuthAuditService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    AuthTokenService,
    AuthLockoutService,
    AuthOtpService,
    AuthPasswordService,
    AuthAuditService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
    JwtModule,
  ],
})
export class AuthModule {}
