"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getFaqItems,
  updateFaqItem,
  type FaqAdminItem,
  type UpdateFaqItemPayload,
} from "@/lib/chat";

const PARAM_LABELS: Record<string, string> = {
  hours: "Giờ mở cửa",
  address: "Địa chỉ",
  phone: "Hotline/Zalo",
  bank_name: "Ngân hàng",
  account_number: "Số tài khoản",
  account_holder: "Chủ tài khoản",
  methods: "Hình thức thanh toán",
  deposit: "Mức cọc",
  duration: "Thời gian thuê",
  shipping: "Giao nhận",
  penalty: "Quy định trả trễ/đền bù",
  laundry: "Vệ sinh trang phục",
  documents: "Giấy tờ cần mang",
  policy: "Chính sách đổi size/hủy",
  promotions: "Ưu đãi",
  accessories: "Phụ kiện/dịch vụ",
  try_on: "Đặt lịch thử đồ",
};

const FAQ_KEY_META: Record<string, { label: string; description: string }> = {
  opening_hours: {
    label: "Giờ mở cửa",
    description: "Shop mở cửa lúc nào để khách ghé xem/thử đồ.",
  },
  address: {
    label: "Địa chỉ shop",
    description: "Địa chỉ cửa hàng khách dùng để ghé hoặc gửi đồ.",
  },
  phone: {
    label: "Hotline / Zalo",
    description: "Số điện thoại hoặc Zalo để khách liên hệ.",
  },
  bank_account: {
    label: "Tài khoản ngân hàng",
    description: "Thông tin chuyển khoản: ngân hàng, số tài khoản, chủ tài khoản.",
  },
  payment_methods: {
    label: "Hình thức thanh toán",
    description: "Các cách shop nhận thanh toán (tiền mặt, chuyển khoản...).",
  },
  deposit_policy: {
    label: "Chính sách tiền cọc",
    description: "Mức cọc và quy định hoàn cọc khi thuê đồ.",
  },
  rental_duration: {
    label: "Thời gian thuê",
    description: "Thời gian thuê tối thiểu/tối đa và cách tính ngày.",
  },
  shipping: {
    label: "Giao nhận / vận chuyển",
    description: "Shop giao đồ tận nơi hay khách tự lấy, phí giao thế nào.",
  },
  late_return_penalty: {
    label: "Trả trễ & đền bù",
    description: "Phí trả trễ và quy định bồi thường khi hư hỏng.",
  },
  laundry: {
    label: "Vệ sinh trang phục",
    description: "Khách có phải tự giặt hay shop vệ sinh trước/sau khi thuê.",
  },
  documents: {
    label: "Giấy tờ khi thuê",
    description: "Giấy tờ khách cần mang theo để làm hợp đồng thuê.",
  },
  size_exchange_policy: {
    label: "Đổi size / hủy đơn",
    description: "Chính sách đổi size hoặc hủy đơn sau khi đặt.",
  },
  promotions: {
    label: "Ưu đãi",
    description: "Khuyến mãi, giảm giá khi thuê nhiều bộ hoặc theo dịp.",
  },
  accessories_services: {
    label: "Phụ kiện & dịch vụ",
    description: "Phụ kiện đi kèm và các dịch vụ cộng thêm.",
  },
  try_on_appointment: {
    label: "Đặt lịch thử đồ",
    description: "Cách khách đặt lịch thử đồ trước khi thuê.",
  },
};

function faqMeta(key: string) {
  return (
    FAQ_KEY_META[key] ?? {
      label: key,
      description: "Câu hỏi thường gặp của khách.",
    }
  );
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: {
    label: "Đang bật",
    className: "bg-jade/10 text-jade border-jade/30",
  },
  inactive: {
    label: "Đang tắt",
    className: "bg-stone-100 text-stone-600 border-stone-200",
  },
  missing: {
    label: "Chưa cấu hình",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

type Draft = {
  intent: string;
  answerTemplate: string;
  values: Record<string, string>;
  notApplicable: boolean;
  notApplicableReply: string;
  isActive: boolean;
};

function draftFrom(item: FaqAdminItem): Draft {
  return {
    intent: item.intent,
    answerTemplate: item.answerTemplate,
    values: { ...item.values },
    notApplicable: item.notApplicable,
    notApplicableReply: item.notApplicableReply ?? "",
    isActive: item.isActive,
  };
}

function placeholdersIn(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function statusOf(item: FaqAdminItem) {
  if (!item.isActive && !item.exists) return STATUS_LABELS.missing;
  return item.isActive ? STATUS_LABELS.active : STATUS_LABELS.inactive;
}

export function FaqManagerClient() {
  const { user } = useAuth();
  const canManage = user?.role === "manager_owner" || user?.role === "admin";

  const [items, setItems] = useState<FaqAdminItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bankConfirmed, setBankConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.key === selectedKey) ?? null,
    [items, selectedKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await getFaqItems();
    if (res.success && res.data) {
      setItems(res.data);
      setSelectedKey((prev) => prev ?? res.data?.[0]?.key ?? null);
    } else {
      setLoadError(res.message ?? "Không tải được cấu hình FAQ.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void load();
  }, [canManage, load]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft(draftFrom(selected));
    setBankConfirmed(false);
  }, [selected]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const fields = useMemo(() => {
    if (!selected || !draft) return [];
    const names = new Set<string>([
      ...selected.requiredParams,
      ...placeholdersIn(draft.answerTemplate),
    ]);
    return [...names];
  }, [selected, draft]);

  function selectItem(item: FaqAdminItem) {
    setSelectedKey(item.key);
  }

  function updateValue(name: string, value: string) {
    setDraft((prev) => (prev ? { ...prev, values: { ...prev.values, [name]: value } } : prev));
  }

  function resetDraft() {
    if (!selected) return;
    setDraft(draftFrom(selected));
    setBankConfirmed(false);
  }

  async function handleSave() {
    if (!selected || !draft || saving) return;

    const isBank = selected.key === "bank_account";
    if (isBank && !bankConfirmed) {
      setToast({
        kind: "error",
        message: "Vui lòng xác nhận trước khi lưu thông tin ngân hàng/STK.",
      });
      return;
    }

    const payload: UpdateFaqItemPayload = {
      intent: draft.intent,
      answerTemplate: draft.answerTemplate,
      values: Object.fromEntries(
        fields.map((name) => [name, draft.values[name] ?? ""]),
      ),
      notApplicable: draft.notApplicable,
      notApplicableReply: draft.notApplicableReply,
      isActive: draft.isActive,
      ...(isBank ? { confirm: true } : {}),
    };

    setSaving(true);
    const res = await updateFaqItem(selected.key, payload);
    setSaving(false);

    if (!res.success || !res.data) {
      setToast({ kind: "error", message: res.message ?? "Lưu FAQ thất bại." });
      return;
    }

    const saved = res.data;
    setItems((prev) =>
      prev.map((item) => (item.key === saved.key ? saved : item)),
    );
    setBankConfirmed(false);
    setToast({
      kind: "success",
      message: isBank ? "Đã lưu cấu hình ngân hàng/STK." : "Đã lưu cấu hình FAQ.",
    });
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Chỉ quản lý/chủ cửa hàng hoặc admin mới được cấu hình FAQ.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-sand bg-white p-6 text-sm text-stone-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tải cấu hình FAQ...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="font-semibold">Không tải được cấu hình FAQ.</p>
        <p className="mt-1">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
      {toast && (
        <div
          role="status"
          className={`fixed right-6 top-20 z-[120] flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${
            toast.kind === "success"
              ? "border-jade/30 bg-jade/5 text-jade"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      <aside className="rounded-xl border border-sand bg-white p-3 shadow-sm">
        <div className="border-b border-sand/70 px-2 pb-2">
          <h3 className="text-sm font-semibold text-ink">Danh mục FAQ</h3>
          <p className="mt-0.5 text-[11px] text-stone-500">
            Chỉ nhập giá trị do chủ shop cung cấp.
          </p>
        </div>
        <ul className="mt-2 max-h-[560px] space-y-1 overflow-y-auto pr-1">
          {items.map((item) => {
            const status = statusOf(item);
            const meta = faqMeta(item.key);
            const isSelected = item.key === selectedKey;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => selectItem(item)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-lotus/40 bg-lotus/5"
                      : "border-transparent hover:border-sand/70 hover:bg-parchment"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-ink">
                      {meta.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-stone-500">
                    {meta.description}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {!selected || !draft ? (
        <div className="rounded-xl border border-sand bg-white p-6 text-sm text-stone-500">
          Chọn một mục FAQ để cấu hình.
        </div>
      ) : (
        <section className="space-y-4 rounded-xl border border-sand bg-white p-5 shadow-sm">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-sand/70 pb-3">
            <div>
              <h3 className="font-display text-xl text-ink">
                {faqMeta(selected.key).label}
              </h3>
              <p className="text-xs text-stone-500">
                {faqMeta(selected.key).description}
              </p>
              <p className="mt-0.5 text-[11px] text-stone-400">
                Mã: {selected.key} ·{" "}
                {selected.exists
                  ? `Cập nhật lần cuối: ${
                      selected.updatedAt
                        ? new Date(selected.updatedAt).toLocaleString("vi-VN")
                        : "—"
                    }`
                  : "Chưa có trong DB — đang dùng mẫu mặc định."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetDraft}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-full border border-sand px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-parchment disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Hoàn tác
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || (selected.key === "bank_account" && !bankConfirmed)}
                className="inline-flex items-center gap-1.5 rounded-full bg-lotus px-4 py-1.5 text-xs font-semibold text-white hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Lưu
              </button>
            </div>
          </header>

          {selected.missingKeys.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-semibold">Còn thiếu giá trị:</p>
              <p className="mt-0.5 break-words">
                {selected.missingKeys
                  .map((key) => PARAM_LABELS[key] ?? key)
                  .join(", ")}{" "}
                — cần nhập đủ trước khi bật FAQ.
              </p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-semibold text-stone-600">
              Mã kỹ thuật
              <span className="ml-1 font-normal text-[10px] text-stone-400">
                (chỉ sửa khi được hướng dẫn)
              </span>
              <input
                value={draft.intent}
                onChange={(event) =>
                  setDraft({ ...draft, intent: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-sand px-3 py-2 font-mono text-xs font-normal text-stone-500 focus:border-lotus focus:outline-none"
              />
            </label>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-600">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) =>
                    setDraft({ ...draft, isActive: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-sand text-lotus"
                />
                Bật FAQ này
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-600">
                <input
                  type="checkbox"
                  checked={draft.notApplicable}
                  onChange={(event) =>
                    setDraft({ ...draft, notApplicable: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-sand text-lotus"
                />
                Không áp dụng (trả lời riêng)
              </label>
            </div>
          </div>

          {fields.length > 0 && !draft.notApplicable && (
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((name) => (
                <label
                  key={name}
                  className="block text-xs font-semibold text-stone-600"
                >
                  {PARAM_LABELS[name] ?? name}
                  <span className="ml-1 font-mono font-normal text-[10px] text-stone-400">
                    {`{{${name}}}`}
                  </span>
                  <input
                    value={draft.values[name] ?? ""}
                    onChange={(event) => updateValue(name, event.target.value)}
                    placeholder="Để trống nếu chưa có thông tin"
                    className="mt-1 w-full rounded-lg border border-sand px-3 py-2 text-sm font-normal text-ink focus:border-lotus focus:outline-none"
                  />
                </label>
              ))}
            </div>
          )}

          {draft.notApplicable ? (
            <label className="block text-xs font-semibold text-stone-600">
              Câu trả lời khi không áp dụng
              <textarea
                value={draft.notApplicableReply}
                onChange={(event) =>
                  setDraft({ ...draft, notApplicableReply: event.target.value })
                }
                rows={3}
                className="mt-1 w-full rounded-lg border border-sand px-3 py-2 text-sm font-normal text-ink focus:border-lotus focus:outline-none"
              />
            </label>
          ) : (
            <label className="block text-xs font-semibold text-stone-600">
              Mẫu câu trả lời (dùng {"{{param}}"})
              <textarea
                value={draft.answerTemplate}
                onChange={(event) =>
                  setDraft({ ...draft, answerTemplate: event.target.value })
                }
                rows={4}
                className="mt-1 w-full rounded-lg border border-sand px-3 py-2 font-mono text-xs font-normal text-ink focus:border-lotus focus:outline-none"
              />
            </label>
          )}

          {selected.key === "bank_account" && (
            <label className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <input
                type="checkbox"
                checked={bankConfirmed}
                onChange={(event) => setBankConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-rose-300 text-rose-600"
              />
              <span>
                Tôi xác nhận thay đổi thông tin ngân hàng/số tài khoản/chủ tài
                khoản. Mọi thay đổi đều được ghi audit (chỉ tên field, không ghi
                giá trị).
              </span>
            </label>
          )}

          <p className="text-[11px] leading-relaxed text-stone-500">
            Giá trị chỉ lấy từ dữ liệu shop cung cấp. Để trống và tắt FAQ nếu
            chưa có thông tin — khách sẽ được chuyển cho nhân viên thay vì nhận
            câu trả lời bịa.
          </p>
        </section>
      )}
    </div>
  );
}
