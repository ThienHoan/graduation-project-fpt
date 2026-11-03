"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/common/pagination";
import {
  getNotificationLogs,
  getNotificationSettings,
  getNotificationTemplates,
  sendTestNotification,
  updateNotificationSettings,
  updateNotificationTemplates,
  type NotificationLogEntry,
  type NotificationSettings,
  type NotificationTemplate,
  type NotificationTemplatesMap,
} from "@/lib/api";

type NotificationSettingsForm = {
  provider: "mock" | "smtp";
  smtpService: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  passwordConfigured: boolean;
};

const EMPTY_SETTINGS: NotificationSettingsForm = {
  provider: "mock",
  smtpService: "",
  smtpHost: "",
  smtpPort: "",
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  fromEmail: "",
  fromName: "",
  replyTo: "",
  passwordConfigured: false,
};

const DEFAULT_TEST_TEMPLATE = "booking.created";
const TEMPLATES_PER_PAGE = 4;

function toFormSettings(settings: NotificationSettings): NotificationSettingsForm {
  return {
    provider: settings.provider,
    smtpService: settings.smtp.service ?? "",
    smtpHost: settings.smtp.host ?? "",
    smtpPort: settings.smtp.port ? String(settings.smtp.port) : "",
    smtpSecure: settings.smtp.secure,
    smtpUser: settings.smtp.user ?? "",
    smtpPassword: "",
    fromEmail: settings.smtp.fromEmail ?? "",
    fromName: settings.smtp.fromName ?? "",
    replyTo: settings.smtp.replyTo ?? "",
    passwordConfigured: settings.smtp.passwordConfigured,
  };
}

function toTemplateList(templates: NotificationTemplatesMap) {
  return Object.entries(templates).sort(([a], [b]) => a.localeCompare(b, "vi"));
}

function formatLogMetadata(value: unknown) {
  if (value == null) return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}…` : text;
  } catch {
    return String(value);
  }
}

export function NotificationConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [settingsForm, setSettingsForm] = useState<NotificationSettingsForm>(EMPTY_SETTINGS);
  const [templates, setTemplates] = useState<NotificationTemplatesMap>({});
  const [logs, setLogs] = useState<NotificationLogEntry[]>([]);

  const [templatePage, setTemplatePage] = useState(1);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const [testEmail, setTestEmail] = useState("");
  const [testTemplateKey, setTestTemplateKey] = useState(DEFAULT_TEST_TEMPLATE);
  const [testRecipientName, setTestRecipientName] = useState("");
  const [testDataJson, setTestDataJson] = useState('{\n  "recipientName": "Khách hàng",\n  "bookingId": "BK-001"\n}');

  const templateEntries = useMemo(() => toTemplateList(templates), [templates]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorMsg(null);

      try {
        const [settingsRes, templatesRes, logsRes] = await Promise.all([
          getNotificationSettings(),
          getNotificationTemplates(),
          getNotificationLogs(8),
        ]);

        if (!active) return;

        if (settingsRes.success && settingsRes.data) {
          setSettingsForm(toFormSettings(settingsRes.data));
        }

        if (templatesRes.success && templatesRes.data) {
          setTemplates(templatesRes.data);
          const firstKey = Object.keys(templatesRes.data)[0];
          if (firstKey) setTestTemplateKey(firstKey);
        }

        if (logsRes.success && logsRes.data) {
          setLogs(logsRes.data);
        }
      } catch {
        if (active) {
          setErrorMsg("Không thể tải cấu hình thông báo.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  function showSuccess(message: string) {
    setSuccessMsg(message);
    window.setTimeout(() => setSuccessMsg(null), 3500);
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSettings(true);
    setErrorMsg(null);

    try {
      const port = settingsForm.smtpPort.trim() ? Number(settingsForm.smtpPort) : undefined;
      const res = await updateNotificationSettings({
        provider: settingsForm.provider,
        smtpService: settingsForm.smtpService.trim() || undefined,
        smtpHost: settingsForm.smtpHost.trim() || undefined,
        smtpPort: Number.isFinite(port) ? port : undefined,
        smtpSecure: settingsForm.smtpSecure,
        smtpUser: settingsForm.smtpUser.trim() || undefined,
        smtpPassword: settingsForm.smtpPassword.trim() || undefined,
        fromEmail: settingsForm.fromEmail.trim() || undefined,
        fromName: settingsForm.fromName.trim() || undefined,
        replyTo: settingsForm.replyTo.trim() || undefined,
      });

      if (!res.success) {
        setErrorMsg(res.message ?? "Không thể lưu cấu hình thông báo.");
        return;
      }

      setSettingsForm((current) => ({ ...current, smtpPassword: "", passwordConfigured: true }));
      showSuccess("Đã lưu cấu hình thông báo.");
      const logsRes = await getNotificationLogs(8);
      if (logsRes.success && logsRes.data) setLogs(logsRes.data);
    } catch {
      setErrorMsg("Không thể lưu cấu hình thông báo.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveTemplates() {
    setSavingTemplates(true);
    setErrorMsg(null);

    try {
      const res = await updateNotificationTemplates(templates);
      if (!res.success) {
        setErrorMsg(res.message ?? "Không thể lưu mẫu thông báo.");
        return;
      }

      showSuccess("Đã lưu mẫu thông báo.");
      const logsRes = await getNotificationLogs(8);
      if (logsRes.success && logsRes.data) setLogs(logsRes.data);
    } catch {
      setErrorMsg("Không thể lưu mẫu thông báo.");
    } finally {
      setSavingTemplates(false);
    }
  }

  async function handleSendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendingTest(true);
    setErrorMsg(null);

    try {
      let data: Record<string, unknown> | undefined;
      const trimmed = testDataJson.trim();
      if (trimmed) {
        data = JSON.parse(trimmed) as Record<string, unknown>;
      }

      const res = await sendTestNotification({
        email: testEmail.trim(),
        templateKey: testTemplateKey,
        recipientName: testRecipientName.trim() || undefined,
        data,
      });

      if (!res.success) {
        setErrorMsg(res.message ?? "Không thể gửi email thử.");
        return;
      }

      showSuccess("Đã gửi thử thông báo.");
      const logsRes = await getNotificationLogs(8);
      if (logsRes.success && logsRes.data) setLogs(logsRes.data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Không thể gửi email thử.");
    } finally {
      setSendingTest(false);
    }
  }

  function updateTemplate(key: string, patch: Partial<NotificationTemplate>) {
    setTemplates((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }));
  }

  const totalTemplatePages = Math.max(1, Math.ceil(templateEntries.length / TEMPLATES_PER_PAGE));
  const currentTemplatePage = Math.min(templatePage, totalTemplatePages);
  const pagedTemplateEntries = templateEntries.slice(
    (currentTemplatePage - 1) * TEMPLATES_PER_PAGE,
    currentTemplatePage * TEMPLATES_PER_PAGE,
  );

  return (
    <section className="space-y-8 rounded-xl border border-sand bg-white p-6 shadow-sm">
      {successMsg ? (
        <div className="rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
          {successMsg}
        </div>
      ) : null}

      {errorMsg ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMsg}
        </div>
      ) : null}

      {loading ? (
        <div className="py-10 text-sm text-stone-400">Đang tải cấu hình thông báo...</div>
      ) : (
        <div className="space-y-8">
          <form onSubmit={handleSaveSettings} className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-xl border border-sand bg-mist p-5">
              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Kênh gửi</h4>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Provider</label>
                <select
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-antique"
                  value={settingsForm.provider}
                  onChange={(e) => setSettingsForm((current) => ({ ...current, provider: e.target.value as NotificationSettingsForm["provider"] }))}
                >
                  <option value="mock">Mock</option>
                  <option value="smtp">SMTP</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">SMTP service</label>
                  <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.smtpService} onChange={(e) => setSettingsForm((current) => ({ ...current, smtpService: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Host</label>
                  <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.smtpHost} onChange={(e) => setSettingsForm((current) => ({ ...current, smtpHost: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Port</label>
                  <input type="number" className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.smtpPort} onChange={(e) => setSettingsForm((current) => ({ ...current, smtpPort: e.target.value }))} />
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-sand bg-white px-3 py-2 text-sm text-stone-600">
                  <input type="checkbox" checked={settingsForm.smtpSecure} onChange={(e) => setSettingsForm((current) => ({ ...current, smtpSecure: e.target.checked }))} />
                  Secure TLS
                </label>
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-sand bg-white p-5">
              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Danh tính gửi</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">SMTP user</label>
                  <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.smtpUser} onChange={(e) => setSettingsForm((current) => ({ ...current, smtpUser: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Password</label>
                  <input type="password" placeholder={settingsForm.passwordConfigured ? "Đã lưu sẵn, nhập mới nếu muốn đổi" : "Nhập mật khẩu SMTP"} className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.smtpPassword} onChange={(e) => setSettingsForm((current) => ({ ...current, smtpPassword: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">From email</label>
                  <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.fromEmail} onChange={(e) => setSettingsForm((current) => ({ ...current, fromEmail: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">From name</label>
                  <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.fromName} onChange={(e) => setSettingsForm((current) => ({ ...current, fromName: e.target.value }))} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Reply-to</label>
                  <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={settingsForm.replyTo} onChange={(e) => setSettingsForm((current) => ({ ...current, replyTo: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 flex justify-end">
              <button type="submit" disabled={savingSettings} className="rounded-lg bg-lotus px-5 py-3 text-sm font-semibold text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60">
                {savingSettings ? "Đang lưu..." : "Lưu cấu hình thông báo"}
              </button>
            </div>
          </form>

          <div className="space-y-4 rounded-xl border border-sand bg-mist p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Mẫu thông báo</h4>
                <p className="text-sm text-stone-500">Sửa nội dung hiển thị cho email và thông báo trong ứng dụng.</p>
              </div>
              <button type="button" onClick={handleSaveTemplates} disabled={savingTemplates} className="rounded-lg border border-lotus px-4 py-2 text-sm font-semibold text-lotus transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
                {savingTemplates ? "Đang lưu..." : "Lưu mẫu thông báo"}
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {pagedTemplateEntries.map(([key, template]) => (
                <div key={key} className="rounded-xl border border-sand bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h5 className="font-semibold text-ink">{key}</h5>
                      <p className="text-xs text-stone-500">Kênh: {template.channels.join(", ") || "none"}</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-stone-600">
                      <input type="checkbox" checked={template.enabled} onChange={(e) => updateTemplate(key, { enabled: e.target.checked })} />
                      Bật
                    </label>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">Subject</label>
                      <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={template.subject} onChange={(e) => updateTemplate(key, { subject: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">Title</label>
                      <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={template.title} onChange={(e) => updateTemplate(key, { title: e.target.value })} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">Body</label>
                      <textarea rows={4} className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={template.body} onChange={(e) => updateTemplate(key, { body: e.target.value })} />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-sand bg-mist px-3 py-2 text-sm">
                      <label className="flex items-center gap-2 text-stone-600">
                        <input
                          type="checkbox"
                          checked={template.channels.includes("email")}
                          onChange={(e) => updateTemplate(key, { channels: e.target.checked ? Array.from(new Set([...(template.channels ?? []), "email"])) as NotificationTemplate["channels"] : template.channels.filter((channel) => channel !== "email") })}
                        />
                        Email
                      </label>
                      <label className="flex items-center gap-2 text-stone-600">
                        <input
                          type="checkbox"
                          checked={template.channels.includes("inApp")}
                          onChange={(e) => updateTemplate(key, { channels: e.target.checked ? Array.from(new Set([...(template.channels ?? []), "inApp"])) as NotificationTemplate["channels"] : template.channels.filter((channel) => channel !== "inApp") })}
                        />
                        In-app
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Pagination
              currentPage={currentTemplatePage}
              totalItems={templateEntries.length}
              pageSize={TEMPLATES_PER_PAGE}
              onPageChange={setTemplatePage}
              itemLabel="mẫu"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <form onSubmit={handleSendTest} className="space-y-4 rounded-xl border border-sand bg-white p-5 lg:col-span-1">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Gửi thử</h4>
                <p className="text-sm text-stone-500">Dùng một template bất kỳ để kiểm tra email và log.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Email</label>
                <input required type="email" className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Template</label>
                <select className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-antique" value={testTemplateKey} onChange={(e) => setTestTemplateKey(e.target.value)}>
                  {templateEntries.map(([key]) => <option key={key} value={key}>{key}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Tên người nhận</label>
                <input className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique" value={testRecipientName} onChange={(e) => setTestRecipientName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Data JSON</label>
                <textarea rows={8} className="w-full rounded-lg border border-sand px-3 py-2 text-xs outline-none focus:border-antique" value={testDataJson} onChange={(e) => setTestDataJson(e.target.value)} />
              </div>
              <button type="submit" disabled={sendingTest} className="w-full rounded-lg bg-jade px-4 py-3 text-sm font-semibold text-white transition hover:bg-forest disabled:cursor-not-allowed disabled:opacity-60">
                {sendingTest ? "Đang gửi..." : "Gửi thông báo thử"}
              </button>
            </form>

            <div className="space-y-4 rounded-xl border border-sand bg-white p-5 lg:col-span-2">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Nhật ký gần đây</h4>
                <p className="text-sm text-stone-500">Theo dõi các lần cập nhật setting, template và lần gửi thử.</p>
              </div>

              {logs.length === 0 ? (
                <p className="py-8 text-sm text-stone-400">Chưa có log thông báo.</p>
              ) : (
                <div className="space-y-3">
                  {logs.map((entry) => (
                    <article key={entry.id} className="rounded-lg border border-sand bg-mist p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink">{entry.action}</p>
                          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ""}</p>
                        </div>
                        <time className="text-xs text-stone-400" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("vi-VN")}</time>
                      </div>
                      {formatLogMetadata(entry.metadata) ? (
                        <p className="mt-2 text-sm text-stone-600">{formatLogMetadata(entry.metadata)}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
