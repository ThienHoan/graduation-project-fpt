import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

// RealtimeModule là module "lá": không import AuthModule để tránh vòng phụ thuộc
// (NotificationsModule → RealtimeModule → AuthModule → NotificationsModule).
// JwtModule được đăng ký riêng với cùng JWT_SECRET nên gateway tự xác thực được token.
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET") ?? "dev-secret-change-me",
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}