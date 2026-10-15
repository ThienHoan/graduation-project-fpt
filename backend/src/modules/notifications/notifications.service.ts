import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppRole, Notification as NotificationRow, Prisma } from "@prisma/client";
import * as nodemailer from "nodemailer";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";
import type { UpdateNotificationSettingsDto } from "./dto/update-notification-settings.dto";

export type NotificationChannel = "email" | "inApp";

export type NotificationTemplate = {
  subject: string;
  title: string;
  body: string;
  channels: NotificationChannel[];
  enabled: boolean;
};

export type NotificationTemplateMap = Record<string, NotificationTemplate>;

export type NotificationSettings = {
  provider: "mock" | "smtp";
  smtp: {
    service: string | null;
    host: string | null;
    port: number | null;
    secure: boolean;
    user: string | null;
    password: string | null;
    fromEmail: string | null;
    fromName: string | null;
    replyTo: string | null;
  };
};

export type NotificationPreferences = {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  bookingUpdatesEnabled: boolean;
  paymentUpdatesEnabled: boolean;
  reminderEnabled: boolean;
  marketingEnabled: boolean;
};

export type NotificationSendStatus = {
  status: "sent" | "skipped" | "failed";
  provider: "smtp" | "mock";
  reason?: string;
};

const SETTINGS_KEY = "notification:settings";
const TEMPLATES_KEY = "notification:templates";
const DEFAULT_CHANNELS: NotificationChannel[] = ["inApp", "email"];

const DEFAULT_TEMPLATES: NotificationTemplateMap = {
  "auth.verification_code": {
    subject: "Mã xác nhận tài khoản Cổ Phục ERP",
    title: "Xác thực tài khoản",
    body: "Xin chào {{recipientName}},\nMã OTP của bạn là {{code}}. Mã này hết hạn sau {{expiresIn}} phút.",
    channels: ["email"],
    enabled: true,
  },
  "auth.password_reset": {
    subject: "Đặt lại mật khẩu Cổ Phục ERP",
    title: "Đặt lại mật khẩu",
    body: "Xin chào {{recipientName}},\nMã OTP đặt lại mật khẩu của bạn là {{code}}. Mã này hết hạn sau {{expiresIn}} phút.",
    channels: ["email"],
    enabled: true,
  },
  "booking.created": {
    subject: "Đơn thuê mới đã được tạo",
    title: "Đơn thuê mới",
    body: "Đơn #{{bookingCode}} — {{garmentName}} từ {{startDate}} đến {{endDate}}.",
    channels: ["inApp", "email"],
    enabled: true,
  },
  "booking.status_changed": {
    subject: "Trạng thái đơn thuê đã thay đổi",
    title: "Cập nhật đơn thuê",
    body: "Đơn #{{bookingCode}} đã chuyển sang trạng thái {{statusLabel}}.",
    channels: ["inApp"],
    enabled: true,
  },
  "booking.payment_received": {
    subject: "Đã ghi nhận thanh toán",
    title: "Thanh toán thành công",
    body: "Đơn #{{bookingCode}} — thanh toán {{amount}}.",
    channels: ["inApp", "email"],
    enabled: true,
  },
  "booking.cancelled": {
    subject: "Đơn thuê đã bị hủy",
    title: "Đơn thuê bị hủy",
    body: "Đơn #{{bookingCode}} đã bị hủy.",
    channels: ["inApp", "email"],
    enabled: true,
  },
  "booking.overdue": {
    subject: "Đơn thuê đã quá hạn",
    title: "Đơn thuê quá hạn {{overdueDays}} ngày",
    body: "Đơn #{{bookingCode}} ({{garmentName}}) đã quá hạn {{overdueDays}} ngày so với ngày trả dự kiến {{endDate}}. Phí quá hạn hiện tại: {{amount}}. Vui lòng trả đồ sớm để tránh phí phát sinh thêm.",
    channels: ["inApp", "email"],
    enabled: true,
  },
  "booking.staff.created": {
    subject: "Đơn thuê mới cần xử lý",
    title: "Đơn thuê mới",
    body: "Khách {{customerName}} vừa tạo đơn #{{bookingCode}} ({{garmentName}}) từ {{startDate}} đến {{endDate}}. Vui lòng xác nhận.",
    channels: ["inApp"],
    enabled: true,
  },
  "booking.staff.cancelled": {
    subject: "Khách đã hủy đơn thuê",
    title: "Đơn thuê bị hủy",
    body: "Khách {{customerName}} đã hủy đơn #{{bookingCode}} ({{garmentName}}).",
    channels: ["inApp"],
    enabled: true,
  },
  "booking.staff.paid": {
    subject: "Đơn thuê đã được thanh toán",
    title: "Thanh toán mới",
    body: "Đơn #{{bookingCode}} của khách {{customerName}} — thanh toán {{amount}}. Sẵn sàng chuẩn bị.",
    channels: ["inApp"],
    enabled: true,
  },
  "booking.staff.confirmed": {
    subject: "Đơn thuê đã được xác nhận",
    title: "Đã xác nhận đơn",
    body: "Đã xác nhận đơn #{{bookingCode}} ({{garmentName}}). Vui lòng gắn tài sản.",
    channels: ["inApp"],
    enabled: true,
  },
  "booking.staff.asset_assigned": {
    subject: "Tài sản đã được gán",
    title: "Gán tài sản thành công",
    body: "Đã gán {{assetCode}} vào đơn #{{bookingCode}} ({{garmentName}}).",
    channels: ["inApp"],
    enabled: true,
  },
  "refund.approved": {
    subject: "Đã hoàn cọc",
    title: "Hoàn cọc thành công",
    body: "Đơn #{{bookingCode}} — bạn đã được hoàn cọc {{amount}} qua {{refundMethodLabel}}.",
    channels: ["inApp", "email"],
    enabled: true,
  },
  "refund.closed_no_refund": {
    subject: "Đơn thuê đã hoàn tất",
    title: "Đơn thuê đã hoàn tất",
    body: "Đơn #{{bookingCode}} đã hoàn tất. Do khoản phạt bằng hoặc vượt tiền cọc nên không có khoản hoàn cọc nào.",
    channels: ["inApp"],
    enabled: true,
  },
  "notification.test": {
    subject: "Kiểm tra Notification Service",
    title: "Thông báo kiểm tra",
    body: "Đây là bản gửi thử từ Notification Service tại {{sentAt}}.",
    channels: ["email"],
    enabled: true,
  },
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
  inAppEnabled: true,
  bookingUpdatesEnabled: true,
  paymentUpdatesEnabled: true,
  reminderEnabled: true,
  marketingEnabled: false,
};

@Injectable()
export class NotificationsService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  async getMyNotifications(userId: string, limit = 50) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { OR: [{ userId }, { userId: null }] },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return ok({
      unreadCount,
      notifications: items.map((item) => this.serializeNotification(item)),
    });
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException("Notification not found.");
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: notification.readAt ?? new Date() },
    });

    return ok(this.serializeNotification(updated));
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return ok({ updatedCount: result.count });
  }

  async getPreferences(userId: string) {
    return ok(await this.loadPreferences(userId));
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    const current = await this.loadPreferences(userId);
    const next: NotificationPreferences = {
      emailEnabled: dto.emailEnabled ?? current.emailEnabled,
      inAppEnabled: dto.inAppEnabled ?? current.inAppEnabled,
      bookingUpdatesEnabled: dto.bookingUpdatesEnabled ?? current.bookingUpdatesEnabled,
      paymentUpdatesEnabled: dto.paymentUpdatesEnabled ?? current.paymentUpdatesEnabled,
      reminderEnabled: dto.reminderEnabled ?? current.reminderEnabled,
      marketingEnabled: dto.marketingEnabled ?? current.marketingEnabled,
    };

    await this.saveSetting(this.preferenceKey(userId), next);
    return ok(next, "Notification preferences updated.");
  }

  async getSettings() {
    return ok(this.sanitizeSettings(await this.loadSettings()));
  }

  async updateSettings(dto: UpdateNotificationSettingsDto) {
    const current = await this.loadSettings();
    const next: NotificationSettings = {
      provider: dto.provider ?? current.provider,
      smtp: {
        service: dto.smtpService ?? current.smtp.service,
        host: dto.smtpHost ?? current.smtp.host,
        port: dto.smtpPort ?? current.smtp.port,
        secure: dto.smtpSecure ?? current.smtp.secure,
        user: dto.smtpUser ?? current.smtp.user,
        password: dto.smtpPassword ?? current.smtp.password,
        fromEmail: dto.fromEmail ?? current.smtp.fromEmail,
        fromName: dto.fromName ?? current.smtp.fromName,
        replyTo: dto.replyTo ?? current.smtp.replyTo,
      },
    };

    await this.saveSetting(SETTINGS_KEY, next);
    await this.recordLog("notification.settings.updated", "system_setting", null, {
      provider: next.provider,
    });

    return ok(this.sanitizeSettings(next), "Notification settings updated.");
  }

  async getTemplates() {
    return ok(await this.loadTemplates());
  }

  async updateTemplates(templates: Record<string, unknown>) {
    const current = await this.loadTemplates();
    const next: NotificationTemplateMap = { ...current };

    for (const [key, value] of Object.entries(templates)) {
      next[key] = this.normalizeTemplate(key, value, current[key]);
    }

    await this.saveSetting(TEMPLATES_KEY, next);
    await this.recordLog("notification.templates.updated", "system_setting", null, {
      templateCount: Object.keys(next).length,
    });

    return ok(next, "Notification templates updated.");
  }

  async getLogs(limit = 50) {
    const logs = await this.prisma.auditLog.findMany({
      where: { action: { startsWith: "notification." } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return ok(
      logs.map((item) => ({
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        metadata: item.metadata,
        createdAt: item.createdAt.toISOString(),
        actorId: item.actorId,
      })),
    );
  }

  async sendTemplateEmail(input: {
    email: string;
    templateKey: string;
    data?: Record<string, unknown>;
  }): Promise<NotificationSendStatus> {
    const templates = await this.loadTemplates();
    const template = templates[input.templateKey] ?? this.fallbackTemplate(input.templateKey);
    return this.sendEmail(template, input.email, {
      ...(input.data ?? {}),
      recipientEmail: input.email,
      sentAt: new Date().toISOString(),
    }, input.templateKey);
  }

  async notifyUser(input: {
    userId?: string;
    email?: string;
    templateKey: string;
    data?: Record<string, unknown>;
    persistInApp?: boolean;
    channels?: NotificationChannel[];
  }) {
    const templates = await this.loadTemplates();
    const template = templates[input.templateKey] ?? this.fallbackTemplate(input.templateKey);
    const user = input.userId
      ? await this.prisma.userAccount.findUnique({
          where: { id: input.userId },
          select: { id: true, email: true, profile: { select: { fullName: true } } },
        })
      : null;
    const data = this.composeTemplateData(user, input.templateKey, input.data ?? {});
    const preferences = input.userId ? await this.loadPreferences(input.userId) : DEFAULT_PREFERENCES;
    const requestedChannels = input.channels ?? template.channels ?? DEFAULT_CHANNELS;
    const activeChannels = requestedChannels.filter((channel) => {
      if (channel === "email") return preferences.emailEnabled;
      if (channel === "inApp") return preferences.inAppEnabled && input.persistInApp !== false;
      return true;
    });
    const email = input.email ?? user?.email ?? null;

    let notificationRow: NotificationRow | null = null;
    if (activeChannels.includes("inApp") && input.userId) {
      notificationRow = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          title: this.render(template.title, data),
          body: this.render(template.body, data),
        },
      });
      // Emit sau khi row đã ghi xong: frontend chỉ dùng event làm tín hiệu refetch.
      this.realtime.notificationCreated(input.userId, {
        id: notificationRow.id,
        bookingId: typeof input.data?.bookingId === "string" ? input.data.bookingId : undefined,
      });
    }

    let emailStatus: NotificationSendStatus | null = null;
    if (activeChannels.includes("email") && email) {
      emailStatus = await this.sendEmail(template, email, data, input.templateKey);
    }

    await this.recordLog(
      emailStatus?.status === "failed" ? "notification.failed" : "notification.sent",
      "notification",
      notificationRow?.id ?? null,
      {
        templateKey: input.templateKey,
        userId: input.userId ?? null,
        email,
        channels: activeChannels,
        emailStatus,
      },
    );

    return ok({
      templateKey: input.templateKey,
      channels: activeChannels,
      notificationId: notificationRow?.id ?? null,
      emailStatus,
    });
  }

  async sendBookingNotification(input: {
    userId: string;
    templateKey: "booking.created" | "booking.status_changed" | "booking.payment_received" | "booking.cancelled" | "booking.return_reminder" | "booking.overdue";
    bookingId: string;
    garmentName?: string | null;
    startDate?: string;
    endDate?: string;
    statusLabel?: string;
    note?: string | null;
    amount?: string | number;
    overdueDays?: number;
  }) {
    const bookingCode = input.bookingId.slice(0, 8).toUpperCase();
    return this.notifyUser({
      userId: input.userId,
      templateKey: input.templateKey,
      data: {
        bookingId: input.bookingId,
        bookingCode,
        garmentName: input.garmentName ?? "trang phục",
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        statusLabel: input.statusLabel ?? null,
        note: input.note ?? null,
        amount: input.amount ?? null,
        overdueDays: input.overdueDays ?? null,
      },
    });
  }

  async notifyRoles(input: {
    roles: AppRole[];
    templateKey: string;
    data?: Record<string, unknown>;
    channels?: NotificationChannel[];
  }) {
    const recipients = await this.prisma.userAccount.findMany({
      where: { role: { in: input.roles }, isActive: true },
      select: { id: true },
    });

    await Promise.all(
      recipients.map((recipient) =>
        this.notifyUser({
          userId: recipient.id,
          templateKey: input.templateKey,
          data: input.data,
          channels: input.channels,
        }),
      ),
    );

    return ok({ notified: recipients.length });
  }

  async notifyStaffBooking(input: {
    templateKey: "booking.staff.created" | "booking.staff.cancelled" | "booking.staff.paid" | "booking.staff.confirmed" | "booking.staff.asset_assigned";
    bookingId: string;
    customerName?: string | null;
    garmentName?: string | null;
    startDate?: string;
    endDate?: string;
    note?: string | null;
    amount?: string | number;
    assetCode?: string | null;
    roles?: AppRole[];
  }) {
    const bookingCode = input.bookingId.slice(0, 8).toUpperCase();
    return this.notifyRoles({
      roles: input.roles ?? [AppRole.staff, AppRole.manager_owner],
      templateKey: input.templateKey,
      data: {
        bookingId: input.bookingId,
        bookingCode,
        customerName: input.customerName ?? "khách hàng",
        garmentName: input.garmentName ?? "trang phục",
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        note: input.note ?? null,
        amount: input.amount ?? null,
        assetCode: input.assetCode ?? null,
      },
    });
  }

  async sendAuthVerificationEmail(input: { email: string; recipientName?: string | null; code: string; expiresIn: number; }) {
    return this.sendTemplateEmail({
      email: input.email,
      templateKey: "auth.verification_code",
      data: {
        recipientName: input.recipientName ?? input.email,
        code: input.code,
        expiresIn: input.expiresIn,
      },
    });
  }

  async sendPasswordResetEmail(input: { email: string; recipientName?: string | null; code: string; expiresIn: number; }) {
    return this.sendTemplateEmail({
      email: input.email,
      templateKey: "auth.password_reset",
      data: {
        recipientName: input.recipientName ?? input.email,
        code: input.code,
        expiresIn: input.expiresIn,
      },
    });
  }

  async sendTestEmail(input: { email: string; templateKey: string; data?: Record<string, unknown> }) {
    return this.sendTemplateEmail(input);
  }

  private async sendEmail(
    template: NotificationTemplate,
    email: string,
    data: Record<string, unknown>,
    templateKey: string,
  ): Promise<NotificationSendStatus> {
    const settings = await this.loadSettings();

    if (settings.provider !== "smtp") {
      return { status: "skipped", provider: "mock", reason: "provider-mock" };
    }

    const username = settings.smtp.user ?? this.configService.get<string>("SMTP_EMAIL") ?? "";
    const password = settings.smtp.password ?? this.configService.get<string>("SMTP_PASSWORD") ?? "";
    if (!username || !password) {
      return { status: "skipped", provider: "smtp", reason: "smtp-not-configured" };
    }

    const transporter = nodemailer.createTransport(
      settings.smtp.service
        ? {
            service: settings.smtp.service,
            auth: { user: username, pass: password },
          }
        : {
            host: settings.smtp.host ?? "smtp.gmail.com",
            port: settings.smtp.port ?? 587,
            secure: settings.smtp.secure,
            auth: { user: username, pass: password },
          },
    );

    try {
      await transporter.sendMail({
        from: `"${settings.smtp.fromName ?? "Cổ Phục ERP"}" <${settings.smtp.fromEmail ?? username}>`,
        to: email,
        subject: this.render(template.subject, data),
        html: this.wrapEmailHtml(template.title, this.render(template.body, data).replace(/\n/g, "<br />")),
        replyTo: settings.smtp.replyTo ?? undefined,
      });

      return { status: "sent", provider: "smtp" };
    } catch (error) {
      await this.recordLog("notification.failed", "notification", null, {
        templateKey,
        email,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        status: "failed",
        provider: "smtp",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async loadSettings(): Promise<NotificationSettings> {
    const stored = await this.loadSetting<Partial<NotificationSettings>>(SETTINGS_KEY);
    return {
      provider: stored?.provider ?? (this.hasSmtpEnv() ? "smtp" : "mock"),
      smtp: {
        service: stored?.smtp?.service ?? null,
        host: stored?.smtp?.host ?? null,
        port: stored?.smtp?.port ?? null,
        secure: stored?.smtp?.secure ?? false,
        user: stored?.smtp?.user ?? this.configService.get<string>("SMTP_EMAIL") ?? null,
        password: stored?.smtp?.password ?? this.configService.get<string>("SMTP_PASSWORD") ?? null,
        fromEmail: stored?.smtp?.fromEmail ?? this.configService.get<string>("SMTP_EMAIL") ?? null,
        fromName: stored?.smtp?.fromName ?? "Cổ Phục ERP",
        replyTo: stored?.smtp?.replyTo ?? null,
      },
    };
  }

  private sanitizeSettings(settings: NotificationSettings) {
    return {
      provider: settings.provider,
      smtp: {
        service: settings.smtp.service,
        host: settings.smtp.host,
        port: settings.smtp.port,
        secure: settings.smtp.secure,
        user: settings.smtp.user,
        fromEmail: settings.smtp.fromEmail,
        fromName: settings.smtp.fromName,
        replyTo: settings.smtp.replyTo,
        passwordConfigured: Boolean(settings.smtp.password),
      },
    };
  }

  private async loadTemplates(): Promise<NotificationTemplateMap> {
    const stored = await this.loadSetting<Record<string, NotificationTemplate>>(TEMPLATES_KEY);
    return { ...DEFAULT_TEMPLATES, ...(stored ?? {}) };
  }

  private async loadPreferences(userId: string): Promise<NotificationPreferences> {
    const stored = await this.loadSetting<Partial<NotificationPreferences>>(this.preferenceKey(userId));
    return {
      emailEnabled: stored?.emailEnabled ?? DEFAULT_PREFERENCES.emailEnabled,
      inAppEnabled: stored?.inAppEnabled ?? DEFAULT_PREFERENCES.inAppEnabled,
      bookingUpdatesEnabled: stored?.bookingUpdatesEnabled ?? DEFAULT_PREFERENCES.bookingUpdatesEnabled,
      paymentUpdatesEnabled: stored?.paymentUpdatesEnabled ?? DEFAULT_PREFERENCES.paymentUpdatesEnabled,
      reminderEnabled: stored?.reminderEnabled ?? DEFAULT_PREFERENCES.reminderEnabled,
      marketingEnabled: stored?.marketingEnabled ?? DEFAULT_PREFERENCES.marketingEnabled,
    };
  }

  private async loadSetting<T>(key: string): Promise<T | null> {
    const record = await this.prisma.systemSetting.findUnique({ where: { key } });
    return (record?.value as T | null) ?? null;
  }

  private async saveSetting(key: string, value: unknown) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, updatedAt: new Date() },
      update: { value: value as Prisma.InputJsonValue, updatedAt: new Date() },
    });
  }

  private async recordLog(action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonValue) {
    await this.prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        metadata,
      },
    });
  }

  private serializeNotification(notification: NotificationRow) {
    return {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      body: notification.body,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      isRead: Boolean(notification.readAt),
    };
  }

  private normalizeTemplate(
    key: string,
    value: unknown,
    current?: NotificationTemplate,
  ): NotificationTemplate {
    const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const channels = Array.isArray(source.channels)
      ? source.channels.filter((item): item is NotificationChannel => item === "email" || item === "inApp")
      : current?.channels ?? DEFAULT_CHANNELS;

    return {
      subject: typeof source.subject === "string" ? source.subject : current?.subject ?? key,
      title: typeof source.title === "string" ? source.title : current?.title ?? key,
      body: typeof source.body === "string" ? source.body : current?.body ?? "",
      channels,
      enabled: typeof source.enabled === "boolean" ? source.enabled : current?.enabled ?? true,
    };
  }

  private fallbackTemplate(key: string): NotificationTemplate {
    return {
      subject: key,
      title: key,
      body: "{{message}}",
      channels: DEFAULT_CHANNELS,
      enabled: true,
    };
  }

  private composeTemplateData(
    user: { id: string; email: string; profile: { fullName: string | null } | null } | null,
    templateKey: string,
    data: Record<string, unknown>,
  ) {
    return {
      ...data,
      templateKey,
      recipientName: data.recipientName ?? user?.profile?.fullName ?? user?.email ?? data.recipientEmail ?? "bạn",
      recipientEmail: data.recipientEmail ?? user?.email ?? null,
    };
  }

  private render(input: string, data: Record<string, unknown>) {
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey: string) => {
      const value = rawKey.split(".").reduce<unknown>((current, part) => {
        if (current && typeof current === "object") {
          return (current as Record<string, unknown>)[part];
        }
        return undefined;
      }, data);

      return value === undefined || value === null ? "" : String(value);
    });
  }

  private wrapEmailHtml(title: string, body: string) {
    return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Cổ Phục ERP</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f0eb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f0eb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- HEADER WITH GRADIENT -->
          <tr>
            <td style="background: linear-gradient(135deg, #8B0000 0%, #a31515 50%, #c0392b 100%); border-radius: 16px 16px 0 0; padding: 36px 40px 28px; text-align: center;">
              <!-- Logo / Brand Mark -->
              <div style="margin-bottom: 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                  <tr>
                    <td style="width: 48px; height: 48px; background: rgba(255,255,255,0.15); border-radius: 12px; text-align: center; vertical-align: middle;">
                      <span style="font-size: 24px; color: #FFD700;">&#9734;</span>
                    </td>
                  </tr>
                </table>
              </div>
              <div style="font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: rgba(255,215,0,0.9); font-weight: 700; margin-bottom: 8px;">Cổ Phục ERP</div>
              <div style="font-size: 13px; color: rgba(255,255,255,0.7); font-weight: 400;">Hệ thống quản lý cho thuê trang phục cổ phục</div>
            </td>
          </tr>

          <!-- DECORATIVE DIVIDER -->
          <tr>
            <td style="background: #ffffff; padding: 0 40px;">
              <div style="height: 4px; background: linear-gradient(90deg, #8B0000, #D4A017, #8B0000); border-radius: 2px;"></div>
            </td>
          </tr>

          <!-- MAIN CONTENT -->
          <tr>
            <td style="background: #ffffff; padding: 32px 40px 24px;">
              <h1 style="font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 8px; line-height: 1.3;">${title}</h1>
              <div style="width: 40px; height: 3px; background: #D4A017; border-radius: 2px; margin-bottom: 20px;"></div>
              <div style="font-size: 15px; line-height: 1.8; color: #4a4a5a;">${body}</div>
            </td>
          </tr>

          <!-- CTA / INFO BOX -->
          <tr>
            <td style="background: #ffffff; padding: 0 40px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background: #faf6f1; border: 1px solid #e8e0d5; border-radius: 12px; padding: 20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width: 36px; vertical-align: top;">
                          <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #8B0000, #D4A017); border-radius: 8px; text-align: center; line-height: 32px;">
                            <span style="color: #fff; font-size: 16px;">&#9993;</span>
                          </div>
                        </td>
                        <td style="padding-left: 12px; vertical-align: top;">
                          <div style="font-size: 13px; font-weight: 600; color: #8B0000; margin-bottom: 4px;">Cần hỗ trợ?</div>
                          <div style="font-size: 13px; color: #6b6b7b; line-height: 1.6;">Nếu bạn có thắc mắc, vui lòng liên hệ đội ngũ chăm sóc khách hàng qua email hoặc hotline bên dưới.</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background: #1a1a2e; border-radius: 0 0 16px 16px; padding: 28px 40px; text-align: center;">
              <div style="font-size: 12px; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: #D4A017; margin-bottom: 12px;">Cổ Phục ERP</div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.8;">
                Email: cophuctruyenthong@gmail.com &nbsp;|&nbsp; Hotline: 1900 xxxx<br>
                Đà Nẵng, Việt Nam
              </div>
              <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 11px; color: rgba(255,255,255,0.35); line-height: 1.6;">
                  &copy; 2026 Cổ Phục ERP. Bạn nhận email này vì đã đăng ký tài khoản trên hệ thống.<br>
                  Đây là email tự động, vui lòng không trả lời trực tiếp.
                </div>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  private hasSmtpEnv() {
    return Boolean(this.configService.get<string>("SMTP_EMAIL") && this.configService.get<string>("SMTP_PASSWORD"));
  }

  private preferenceKey(userId: string) {
    return `notification:preferences:${userId}`;
  }
}

