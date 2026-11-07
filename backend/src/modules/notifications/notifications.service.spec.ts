import { describe, expect, it, vi } from "vitest";
import { NotificationsService } from "./notifications.service";

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue(undefined),
  })),
}));

const realtimeMock = {
  notificationCreated: vi.fn(),
} as never;

describe("NotificationsService", () => {
  it("sends SMTP emails when a provider is configured", async () => {
    const prisma = {
      systemSetting: {
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { key: string } }) => {
          if (where.key === "notification:settings") {
            return {
              value: {
                provider: "smtp",
                smtp: {
                  service: "gmail",
                  host: null,
                  port: null,
                  secure: false,
                  user: "mailer@example.com",
                  password: "mailer-password",
                  fromEmail: "mailer@example.com",
                  fromName: "C? Ph?c ERP",
                  replyTo: null,
                },
              },
            };
          }
          return null;
        }),
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      userAccount: {
        findUnique: vi.fn(),
      },
    };
    const configService = {
      get: vi.fn((key: string) => {
        if (key === "SMTP_EMAIL") return "mailer@example.com";
        if (key === "SMTP_PASSWORD") return "mailer-password";
        return undefined;
      }),
    };

    const service = new NotificationsService(prisma as never, configService as never, realtimeMock);
    const result = await service.sendAuthVerificationEmail({
      email: "customer@example.com",
      code: "123456",
      expiresIn: 10,
    });

    expect(result.status).toBe("sent");
    expect(prisma.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "notification.failed" }) }),
    );
  });

  it("sends emails via Resend when configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-123" }),
    } as Response);

    const prisma = {
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      notification: {
        create: vi.fn(),
      },
    };
    const configService = {
      get: vi.fn((key: string) => {
        if (key === "RESEND_API_KEY") return "re_test_123456";
        if (key === "RESEND_FROM_EMAIL") return "onboarding@resend.dev";
        return undefined;
      }),
    };

    const service = new NotificationsService(prisma as never, configService as never, realtimeMock);
    const result = await service.sendPasswordResetEmail({
      email: "user@example.com",
      code: "654321",
      expiresIn: 10,
    });

    expect(result.status).toBe("sent");
    expect(result.provider).toBe("resend");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_123456",
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("sends emails via Brevo when configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "<brevo-123>" }),
    } as Response);

    const prisma = {
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      notification: {
        create: vi.fn(),
      },
    };
    const configService = {
      get: vi.fn((key: string) => {
        if (key === "BREVO_API_KEY") return "xkeysib-test-123";
        if (key === "BREVO_SENDER_EMAIL") return "sender@example.com";
        return undefined;
      }),
    };

    const service = new NotificationsService(prisma as never, configService as never, realtimeMock);
    const result = await service.sendPasswordResetEmail({
      email: "user@example.com",
      code: "654321",
      expiresIn: 10,
    });

    expect(result.status).toBe("sent");
    expect(result.provider).toBe("brevo");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "api-key": "xkeysib-test-123",
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("creates an in-app notification and log entry for a user", async () => {
    const prisma = {
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: "notification-1",
          userId: "user-1",
          title: "�on thu� m?i",
          body: "�on thu� BK-1 d� du?c t?o.",
          readAt: null,
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
      },
      userAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "customer@example.com",
          profile: { fullName: "Customer Name" },
        }),
      },
    };
    const configService = { get: vi.fn(() => undefined) };
    const service = new NotificationsService(prisma as never, configService as never, realtimeMock);

    const result = await service.notifyUser({
      userId: "user-1",
      templateKey: "booking.created",
      data: { bookingId: "BK-1", garmentName: "Ao Dai" },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1" }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(result.data?.notificationId).toBe("notification-1");
  });

  it("stores notification preferences in system settings", async () => {
    const prisma = {
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      userAccount: {
        findUnique: vi.fn(),
      },
    };
    const configService = { get: vi.fn(() => undefined) };
    const service = new NotificationsService(prisma as never, configService as never, realtimeMock);

    const result = await service.updatePreferences("user-1", {
      emailEnabled: false,
      inAppEnabled: true,
    });

    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "notification:preferences:user-1" },
      }),
    );
    expect(result.data?.emailEnabled).toBe(false);
    expect(result.data?.inAppEnabled).toBe(true);
  });
});
