import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { HandoffService } from "./handoff.service";

describe("HandoffService", () => {
  let prisma: any;
  let service: HandoffService;
  const previousTtl = process.env.CHAT_HANDOFF_TTL_MINUTES;
  const previousSensitiveTtl = process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES;

  beforeEach(() => {
    process.env.CHAT_HANDOFF_TTL_MINUTES = "30";
    process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES = "1440";
    prisma = {
      conversations: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    service = new HandoffService(prisma as never);
  });

  afterEach(() => {
    if (previousTtl === undefined) {
      delete process.env.CHAT_HANDOFF_TTL_MINUTES;
    } else {
      process.env.CHAT_HANDOFF_TTL_MINUTES = previousTtl;
    }
    if (previousSensitiveTtl === undefined) {
      delete process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES;
    } else {
      process.env.CHAT_HANDOFF_SENSITIVE_TTL_MINUTES = previousSensitiveTtl;
    }
  });

  it("opens a new handoff and asks for exactly one acknowledgement", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: null,
      handoff_reason: null,
      handoff_sensitive: false,
      handoff_pending_count: 0,
    });

    const result = await service.open("conv-1", "complaint", true);

    expect(result).toEqual({ opened: true, shouldAck: true, pendingCount: 1 });
    expect(prisma.conversations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: expect.objectContaining({
          handoff_state: "open",
          handoff_reason: "complaint",
          handoff_sensitive: true,
          handoff_pending_count: 1,
        }),
      }),
    );
  });

  it("does not repeat the acknowledgement while a handoff stays open", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "complaint",
      handoff_sensitive: true,
      handoff_pending_count: 2,
    });

    const result = await service.open("conv-1", "complaint", true);

    expect(result).toEqual({ opened: false, shouldAck: false, pendingCount: 3 });
    expect(prisma.conversations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ handoff_pending_count: { increment: 1 } }),
      }),
    );
  });

  it("records the triggering message when it opens a new handoff", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: null,
      handoff_reason: null,
      handoff_sensitive: false,
      handoff_pending_count: 0,
    });

    await service.open("conv-1", "complaint", true, "msg-trigger");

    expect(prisma.conversations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handoff_trigger_message_id: "msg-trigger",
        }),
      }),
    );
  });

  it("keeps the original triggering message while a handoff stays open", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "complaint",
      handoff_sensitive: true,
      handoff_pending_count: 2,
    });

    await service.open("conv-1", "complaint", true, "msg-second");

    const update = prisma.conversations.update.mock.calls.at(-1)?.[0];
    expect(update?.data).not.toHaveProperty("handoff_trigger_message_id");
  });

  it("resets all handoff fields when staff replies", async () => {
    await service.reset("conv-1");

    expect(prisma.conversations.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: {
        handoff_state: null,
        handoff_reason: null,
        handoff_sensitive: false,
        handoff_opened_at: null,
        handoff_ack_sent_at: null,
        handoff_last_customer_msg_at: null,
        handoff_pending_count: 0,
        handoff_trigger_message_id: null,
      },
    });
  });

  it("never throws when the conversation was deleted", async () => {
    prisma.conversations.findUnique.mockResolvedValue(null);

    await expect(service.open("missing", "refund", true)).resolves.toEqual({
      opened: false,
      shouldAck: false,
      pendingCount: 0,
    });
  });

  it("reports a normal handoff as closed after 31 minutes", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "faq_config_missing",
      handoff_sensitive: false,
      handoff_opened_at: new Date(Date.now() - 31 * 60_000),
    });

    await expect(service.getContext("conv-1")).resolves.toEqual({
      open: false,
      reason: null,
      sensitive: false,
    });
  });

  it("keeps a normal handoff open inside 30 minutes", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "faq_config_missing",
      handoff_sensitive: false,
      handoff_opened_at: new Date(Date.now() - 29 * 60_000),
    });

    await expect(service.getContext("conv-1")).resolves.toEqual({
      open: true,
      reason: "faq_config_missing",
      sensitive: false,
    });
  });

  it("keeps a sensitive handoff open after 31 minutes", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "complaint",
      handoff_sensitive: true,
      handoff_opened_at: new Date(Date.now() - 31 * 60_000),
    });

    await expect(service.getContext("conv-1")).resolves.toEqual({
      open: true,
      reason: "complaint",
      sensitive: true,
    });
  });

  it("closes a sensitive handoff after its 1440-minute TTL", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "complaint",
      handoff_sensitive: true,
      handoff_opened_at: new Date(Date.now() - 1441 * 60_000),
    });

    await expect(service.getContext("conv-1")).resolves.toEqual({
      open: false,
      reason: null,
      sensitive: false,
    });
  });

  it("reopens an expired handoff instead of incrementing the old one", async () => {
    prisma.conversations.findUnique.mockResolvedValue({
      handoff_state: "open",
      handoff_reason: "complaint",
      handoff_sensitive: true,
      handoff_opened_at: new Date(Date.now() - 1441 * 60_000),
      handoff_pending_count: 4,
    });

    const result = await service.open("conv-1", "complaint", true);

    expect(result).toEqual({ opened: true, shouldAck: true, pendingCount: 1 });
    expect(prisma.conversations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handoff_state: "open",
          handoff_pending_count: 1,
        }),
      }),
    );
  });
});
