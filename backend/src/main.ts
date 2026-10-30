import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as dns from "node:dns";
import compression = require("compression");
import helmet from "helmet";

// Ưu tiên IPv4 trước IPv6 để tránh treo kết nối (Connection timeout) trên môi trường VPS Cloud
dns.setDefaultResultOrder("ipv4first");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const rawFrontendUrls = config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
  const allowedOrigins = rawFrontendUrls
    .split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);
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
    // [SECURITY] Cho phép frontend URL chính thức, các domain Vercel và localhost trong môi trường dev
    origin: (origin, callback) => {
      const cleanOrigin = origin?.trim().replace(/\/$/, "");

      if (
        !origin ||
        (cleanOrigin && allowedOrigins.includes(cleanOrigin)) ||
        /^https:\/\/graduation-project-fpt(-[a-zA-Z0-9_-]+)?\.vercel\.app$/.test(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
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
