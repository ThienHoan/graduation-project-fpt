import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression = require("compression");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const frontendUrl = config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
  const port = config.get<number>("PORT") ?? 4000;

  app.setGlobalPrefix("api");
  app.enableCors({
    // Cho phép FRONTEND_URL và mọi origin localhost/127.0.0.1 (dev)
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
