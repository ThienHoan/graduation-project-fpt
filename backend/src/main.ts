import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression = require("compression");
import helmet from "helmet";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const frontendUrl = config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
  const port = config.get<number>("PORT") ?? 4000;

  // [SECURITY FIX] Thêm Helmet để tự động gắn các security headers chuẩn:
  // X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, X-XSS-Protection,
  // Strict-Transport-Security (HSTS), Referrer-Policy, v.v.
  app.use(
    helmet({
      // Tắt CSP mặc định của helmet — CSP được cấu hình riêng ở Next.js layer (frontend)
      // Backend API không phục vụ HTML, không cần CSP
      contentSecurityPolicy: false,
      // Tắt HSTS trong môi trường dev (localhost không có HTTPS)
      // Bật lại khi deploy production bằng cách xóa dòng này hoặc set giá trị tùy môi trường
      hsts: process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    }),
  );

  app.setGlobalPrefix("api");
  app.enableCors({
    // [SECURITY] Chỉ cho phép frontend URL chính thức và localhost trong môi trường dev
    // Trong production, đảm bảo FRONTEND_URL được set đúng (vd: https://cophuc.vn)
    origin: (origin, callback) => {
      if (!origin || origin === frontendUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  // Tăng body limit cho ảnh base64 AI try-on (10MB)
  app.useBodyParser("json", { limit: "10mb" });
  app.useBodyParser("urlencoded", { limit: "10mb", extended: true });

  // Tự động nén toàn bộ HTTP responses (Gzip/Brotli) giảm 70-80% payload
  app.use(compression());

  await app.listen(port);
}

void bootstrap();
