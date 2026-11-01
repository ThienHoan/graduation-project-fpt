import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";
import { AssistantRouterService } from "./assistant/assistant-router.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { io } from "socket.io-client";

function createFakePrisma() {
  const conversations: any[] = [];
  const messages: any[] = [];
  const users: any[] = [];

  return {
    userAccount: {
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null,
    },
    conversations: {
      findFirst: async ({ where }: any) => {
        return conversations.find((c) => c.customer_id === where.customer_id || c.id === where.id) ?? null;
      },
      findMany: async () => conversations.slice(),
      findUnique: async ({ where }: any) => {
        return conversations.find((c) => c.id === where.id) ?? null;
      },
      create: async ({ data }: any) => {
        const conv = { id: `conv-${conversations.length + 1}`, ...data, messages: [], created_at: new Date(), updated_at: new Date() };
        conversations.push(conv);
        return conv;
      },
      update: async ({ where, data }: any) => {
        const conv = conversations.find((c) => c.id === where.id);
        Object.assign(conv, data);
        conv.updated_at = new Date();
        return conv;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        conversations.forEach((c) => {
          if (c.id === where.id && c.staff_id == null) {
            c.staff_id = data.staff_id;
            count++;
          }
        });
        return { count };
      },
    },
    messages: {
      create: async ({ data }: any) => {
        const msg = { id: `msg-${messages.length + 1}`, ...data, created_at: new Date() };
        messages.push(msg);
        return msg;
      },
      findMany: async () => messages.slice(),
      findFirst: async ({ where }: any) => {
        const sorted = [...messages].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return sorted.find((m) => m.conversation_id === where.conversation_id) ?? null;
      },
      count: async () => messages.length,
    },
    // helper to seed users/conversations
    __seed: {
      addUser: (u: any) => users.push(u),
      addConversation: (c: any) => conversations.push(c),
    },
  } as any;
}

describe("Chat integration (live sockets)", () => {
  let app: INestApplication;
  let fakePrisma: any;
  let jwtService: JwtService;
  let gateway: ChatGateway;

  beforeEach(async () => {
    fakePrisma = createFakePrisma();

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: "test-secret" })],
      providers: [
        ChatService,
        ChatGateway,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: AiService, useValue: { productAdvisor: vi.fn(), callOpenRouter: vi.fn() } },
        {
          provide: AssistantRouterService,
          useValue: {
            routeConversation: vi.fn(),
            handleStaffReply: vi.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    jwtService = moduleRef.get(JwtService);
    gateway = moduleRef.get(ChatGateway);

    // seed two users (role is required for gateway handleConnection which uses DB role)
    fakePrisma.__seed.addUser({ id: "cust-1", email: "cust@example.com", role: "customer", isActive: true, profile: { fullName: "Customer One" } });
    fakePrisma.__seed.addUser({ id: "staff-1", email: "staff@example.com", role: "staff", isActive: true, profile: { fullName: "Staff One" } });
  });

  afterEach(async () => {
    await app.close();
  });

  it("customer -> staff claim -> message -> release flow works", async () => {
    const url = await app.getUrl();
    const base = url.replace(/\/$/, "");
    const namespace = `${base}/chat`;

    // create a conversation for customer in fake DB
    const conv = await fakePrisma.conversations.create({ data: { customer_id: "cust-1" } });

    const custToken = jwtService.sign({ sub: "cust-1", role: "customer" });
    const staffToken = jwtService.sign({ sub: "staff-1", role: "staff" });

    const customerSocket = io(namespace, { auth: { token: `Bearer ${custToken}` }, transports: ["websocket"] });
    const staffSocket = io(namespace, { auth: { token: `Bearer ${staffToken}` }, transports: ["websocket"] });

    await new Promise<void>((res) => customerSocket.once("connect", () => res()));
    await new Promise<void>((res) => staffSocket.once("connect", () => res()));

    // join room
    customerSocket.emit("join_room", { conversationId: conv.id });

    // staff opens conversation
    const openResult: any = await new Promise((res) => {
      staffSocket.once("open_conversation_result", (p: any) => res(p));
      staffSocket.emit("open_conversation", { conversationId: conv.id });
    });

    expect(openResult?.canReply).toBe(true);

    // staff sends message and customer should receive it
    const received = new Promise((res) => {
      customerSocket.once("message_received", (p: any) => res(p));
    });

    staffSocket.emit("send_message", { conversationId: conv.id, content: "Hello from staff" });

    const payload: any = await received;
    expect(payload?.message?.content).toBe("Hello from staff");

    // simulate release
    (gateway as any).releaseLock(conv.id);
    expect(gateway.getLockStatus(conv.id).isLocked).toBe(false);

    customerSocket.disconnect();
    staffSocket.disconnect();
  });
});
