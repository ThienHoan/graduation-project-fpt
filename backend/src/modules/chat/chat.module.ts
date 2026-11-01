import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";
import { AssistantContextService } from "./assistant/assistant-context.service";
import { AssistantMetricsService } from "./assistant/assistant-metrics.service";
import { AssistantMetricsScheduler } from "./assistant/assistant-metrics.scheduler";
import { AssistantRouterService } from "./assistant/assistant-router.service";
import { DbHandlersService } from "./assistant/db-handlers.service";
import { FaqAdminController } from "./assistant/faq-admin.controller";
import { FaqAdminService } from "./assistant/faq-admin.service";
import { FaqService } from "./assistant/faq.service";
import { HandoffService } from "./assistant/handoff.service";
import { IdempotencyService } from "./assistant/idempotency.service";
import { RepeatGuardService } from "./assistant/repeat-guard.service";

@Module({
  imports: [PrismaModule, AuthModule, AiModule],
  controllers: [ChatController, FaqAdminController],
  providers: [
    ChatService,
    ChatGateway,
    FaqService,
    FaqAdminService,
    DbHandlersService,
    HandoffService,
    RepeatGuardService,
    IdempotencyService,
    AssistantMetricsService,
    AssistantMetricsScheduler,
    AssistantContextService,
    AssistantRouterService,
  ],
  exports: [AssistantRouterService, FaqService],
})
export class ChatModule {}
