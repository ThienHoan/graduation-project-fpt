"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, MapPin, Plug, Save, SlidersHorizontal, Sparkles, Truck, XCircle, Tag } from "lucide-react";
import { MapPreview } from "@/components/location/map-preview";
import {
  getAdminIntegrations,
  getAdminSettings,
  updateAdminSetting,
  type AdminIntegrationEntry,
  type AdminSettingEntry,
} from "@/lib/api";

type BusinessHours = { open: string; close: string; days: string[] };
type DraftValue = string | boolean | BusinessHours;

const GROUPS: { id: string; title: string; hint: string; icon: typeof SlidersHorizontal; keys: string[] }[] = [
  {
    id: "rental",
    title: "Quy định thuê & hoàn cọc",
    hint: "Giới hạn áp dụng khi tạo đơn và xử lý hoàn cọc.",
    icon: SlidersHorizontal,
    keys: ["max_rental_days", "deposit_refund_window_h", "late_penalty_per_day"],
  },
  {
    id: "store",
    title: "Cửa hàng & giao hàng",
    hint: "Thông tin liên hệ, giờ hoạt động, vị trí atelier và cước vận chuyển.",
    icon: Truck,
    keys: [
      "store_address",
      "store_phone",
      "business_hours",
      "store_lat",
      "store_lng",
      "shipping_fee_intra",
      "shipping_fee_adjacent",
      "shipping_fee_inter",
    ],
  },
  {
    id: "automation",
    title: "Tự động hoá đơn thuê",
    hint: "Quy tắc để hệ thống tự xác nhận đơn thay nhân viên. Đơn không đạt điều kiện vẫn vào hàng chờ duyệt tay.",
    icon: Sparkles,
    keys: [
      "booking_auto_confirm_enabled",
      "booking_auto_confirm_min_completed",
      "booking_auto_confirm_max_total",
      "asset_issue_voucher_percent",
      "asset_issue_voucher_max_amount",
    ],
  },
  {
    id: "pricing",
    title: "Điều chỉnh giá thuê",
    hint: "Tham số cho bộ máy gợi ý giá của quản lý.",
    icon: Tag,
    keys: [
      "pricing_target_rental_days",
      "pricing_abs_min_per_day",
      "pricing_max_uplift_pct",
      "pricing_advice_lead_days",
      "pricing_fail_fast_per_round",
    ],
  },
];

const inputClass =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink outline-none focus:border-antique";

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function toDraft(setting: AdminSettingEntry): DraftValue {
  if (setting.key === "business_hours") {
    const raw = (setting.value ?? {}) as Partial<BusinessHours>;
    return {
      open: typeof raw.open === "string" ? raw.open : "08:00",
      close: typeof raw.close === "string" ? raw.close : "20:00",
      days: Array.isArray(raw.days) ? raw.days : [],
    };
  }
  const raw = unwrap(setting.value);
  if (typeof raw === "boolean") return raw;
  return raw == null ? "" : String(raw);
}

function toPayload(setting: AdminSettingEntry, draft: DraftValue): unknown {
  if (setting.key === "business_hours") return draft;
  if (typeof draft === "boolean") return { value: draft };
  if (setting.kind === "number") return { value: Number(draft) };
  return { value: String(draft).trim() };
}

type Props = {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function SystemConfigPanel({ onSuccess, onError }: Props) {
  const [settings, setSettings] = useState<AdminSettingEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [integrations, setIntegrations] = useState<AdminIntegrationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, integrationsRes] = await Promise.all([getAdminSettings(), getAdminIntegrations()]);
      if (settingsRes.success && settingsRes.data) {
        setSettings(settingsRes.data);
        setDrafts(Object.fromEntries(settingsRes.data.map((item) => [item.key, toDraft(item)])));
      } else {
        onError(settingsRes.error ?? "Không thể tải cấu hình hệ thống");
      }
      if (integrationsRes.success && integrationsRes.data) {
        setIntegrations(integrationsRes.data);
      }
    } catch {
      onError("Lỗi mạng khi tải cấu hình");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const settingByKey = useMemo(() => new Map(settings.map((item) => [item.key, item] as const)), [settings]);

  const changed = useMemo(
    () =>
      settings.filter((item) => JSON.stringify(drafts[item.key]) !== JSON.stringify(toDraft(item))),
    [settings, drafts],
  );

  function setDraft(key: string, value: DraftValue) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (changed.length === 0) {
      onSuccess("Chưa có thay đổi nào để lưu.");
      return;
    }

    for (const item of changed) {
      const draft = drafts[item.key];
      if (item.kind === "number") {
        const num = Number(draft);
        if (typeof draft !== "string" || draft.trim() === "" || !Number.isFinite(num) || num < 0) {
          onError(`"${item.label}" cần là một số không âm.`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      for (const item of changed) {
        const res = await updateAdminSetting(item.key, toPayload(item, drafts[item.key]));
        if (!res.success) {
          onError(res.error ?? `Không thể lưu "${item.label}"`);
          await load();
          return;
        }
      }
      onSuccess(`Đã lưu ${changed.length} thiết lập.`);
      await load();
    } catch {
      onError("Lỗi hệ thống khi lưu cấu hình");
    } finally {
      setSaving(false);
    }
  }

  const lat = parseFloat(String(drafts.store_lat ?? ""));
  const lng = parseFloat(String(drafts.store_lng ?? ""));

  if (loading && settings.length === 0) {
    return <p className="text-sm text-stone-500">Đang tải cấu hình hệ thống...</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-12 items-start">
      <form onSubmit={handleSave} className="lg:col-span-8 space-y-6">
        {GROUPS.map((group) => {
          const GroupIcon = group.icon;
          const items = group.keys.map((key) => settingByKey.get(key)).filter((item): item is AdminSettingEntry => Boolean(item));
          if (items.length === 0) return null;
          return (
            <section key={group.id} className="bg-white rounded-xl border border-sand p-6 shadow-sm">
              <header className="mb-5 border-b border-sand pb-4">
                <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                  <GroupIcon className="h-5 w-5 text-antique" />
                  {group.title}
                </h3>
                <p className="mt-1 text-xs text-stone-500">{group.hint}</p>
              </header>

              <div className="grid gap-5 md:grid-cols-2">
                {items.map((item) => (
                  <SettingField
                    key={item.key}
                    setting={item}
                    draft={drafts[item.key]}
                    onChange={(value) => setDraft(item.key, value)}
                  />
                ))}
              </div>

              {group.id === "store" && Number.isFinite(lat) && Number.isFinite(lng) && (
                <div className="mt-5">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-stone-500">
                    <MapPin className="h-3.5 w-3.5" /> Xem trước vị trí atelier
                  </p>
                  <MapPreview lat={lat} lng={lng} />
                </div>
              )}
            </section>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || changed.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-lotus px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Đang lưu..." : changed.length > 0 ? `Lưu ${changed.length} thay đổi` : "Lưu cấu hình"}
          </button>
          <button
            type="button"
            disabled={saving || changed.length === 0}
            onClick={() => setDrafts(Object.fromEntries(settings.map((item) => [item.key, toDraft(item)])))}
            className="rounded-lg border border-sand bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
          >
            Hoàn tác
          </button>
        </div>
      </form>

      <aside className="lg:col-span-4 space-y-4">
        <section className="bg-white rounded-xl border border-sand p-6 shadow-sm">
          <header className="mb-4 border-b border-sand pb-4">
            <h3 className="text-lg font-bold text-ink flex items-center gap-2">
              <Plug className="h-5 w-5 text-antique" />
              Tích hợp bên ngoài
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              Chỉ xem. Khóa API và mật khẩu nằm trong biến môi trường của máy chủ, không hiển thị và không chỉnh sửa tại đây.
            </p>
          </header>

          <div className="space-y-4">
            {integrations.map((integration) => (
              <article key={integration.key} className="rounded-xl border border-sand bg-warm-ivory/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-sm font-semibold text-ink">{integration.label}</h4>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      integration.configured
                        ? "border-jade/30 bg-jade/5 text-jade"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {integration.configured ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {integration.configured ? "Sẵn sàng" : "Thiếu cấu hình"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">{integration.description}</p>
                <dl className="mt-3 space-y-1 text-xs">
                  {integration.details.map((detail) => (
                    <div key={detail.label} className="flex justify-between gap-3">
                      <dt className="text-stone-500">{detail.label}</dt>
                      <dd className="truncate text-right font-semibold text-ink">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
            {integrations.length === 0 && <p className="text-sm text-stone-500">Không có dữ liệu tích hợp.</p>}
          </div>
        </section>
      </aside>
    </div>
  );
}

function SettingField({
  setting,
  draft,
  onChange,
}: {
  setting: AdminSettingEntry;
  draft: DraftValue | undefined;
  onChange: (value: DraftValue) => void;
}) {
  const label = (
    <>
      <span className="block text-xs font-bold uppercase text-stone-500">{setting.label}</span>
      <span className="mb-1.5 mt-0.5 block text-[11px] text-stone-500">{setting.description}</span>
    </>
  );

  if (setting.key === "business_hours" && draft && typeof draft === "object") {
    const hours = draft as BusinessHours;
    return (
      <div className="md:col-span-2">
        {label}
        <div className="grid grid-cols-2 gap-3">
          <input
            type="time"
            aria-label="Giờ mở cửa"
            value={hours.open}
            onChange={(e) => onChange({ ...hours, open: e.target.value })}
            className={inputClass}
          />
          <input
            type="time"
            aria-label="Giờ đóng cửa"
            value={hours.close}
            onChange={(e) => onChange({ ...hours, close: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
    );
  }

  if (typeof draft === "boolean") {
    return (
      <label className="flex cursor-pointer select-none items-start gap-3 md:col-span-2">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-5 w-5 rounded border-sand text-lotus focus:ring-lotus"
        />
        <span>{label}</span>
      </label>
    );
  }

  const wide = setting.key === "store_address";
  return (
    <label className={wide ? "md:col-span-2" : undefined}>
      {label}
      <input
        type={setting.kind === "number" ? "number" : "text"}
        min={setting.kind === "number" ? 0 : undefined}
        step={setting.kind === "number" ? "any" : undefined}
        value={typeof draft === "string" ? draft : ""}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}
