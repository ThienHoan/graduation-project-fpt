import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantContextService } from "./assistant-context.service";

const CONV = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "customer-1";
const ANCHOR_AT = new Date("2026-10-30T10:00:00.000Z");

function createPrisma() {
  return {
    conversations: {
      findUnique: vi.fn().mockResolvedValue({
        booking_id: null,
        topic: "general",
        handoff_state: "none",
        handoff_reason: null,
        handoff_sensitive: false,
        handoff_opened_at: null,
      }),
    },
    messages: {
      findUnique: vi.fn().mockResolvedValue({
        id: "msg-anchor",
        created_at: ANCHOR_AT,
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "msg-old",
          sender_id: CUSTOMER,
          sender_type: "customer",
          content: "ao dai nay con khong",
          message_type: "text",
          metadata: null,
          created_at: new Date("2026-10-30T09:59:00.000Z"),
        },
      ]),
    },
  };
}

describe("AssistantContextService", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let service: AssistantContextService;

  beforeEach(() => {
    prisma = createPrisma();
    service = new AssistantContextService(prisma as never);
  });

  it("chỉ lấy tin TRƯỚC tin đang được xử lý làm ngữ cảnh", async () => {
    await service.build(CONV, CUSTOMER, "msg-anchor");

    expect(prisma.messages.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "msg-anchor" } }),
    );
    const args = prisma.messages.findMany.mock.calls[0][0];
    expect(args.where.created_at).toEqual({ lt: ANCHOR_AT });
  });

  it("không giới hạn mốc thời gian khi không truyền tin đang xử lý", async () => {
    await service.build(CONV, CUSTOMER);

    expect(prisma.messages.findUnique).not.toHaveBeenCalled();
    const args = prisma.messages.findMany.mock.calls[0][0];
    expect(args.where.created_at).toBeUndefined();
  });
});
