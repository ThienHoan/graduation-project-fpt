"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AddressAutocomplete, type ResolvedAddress } from "@/components/location/address-autocomplete";
import { useAuth } from "@/components/auth/auth-provider";
import { apiRequest } from "@/lib/api";
import { normalizeNullableText } from "@/lib/auth";
import { ConfirmModal } from "@/components/heritage/ui";
import { MapPinOff } from "lucide-react";

/** (new) typed helpers for local use, but backend now returns via apiRequest */
declare global {
  interface Window {
    /** small inline confirm helper */
    confirmDeletingAddress?: unknown;
  }
}

type CustomerAddress = {
  id: string;
  receiverName: string;
  phone: string;
  line1: string;
  ward: string | null;
  district: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
};

type AddressFormState = {
  receiverName: string;
  phone: string;
  line1: string;
  ward: string;
  district: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
};

function createEmptyForm(): AddressFormState {
  return { receiverName: "", phone: "", line1: "", ward: "", district: "", city: "", latitude: null, longitude: null, isDefault: false };
}

/* Underline input style */
const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "transparent",
  border: "none",
  borderBottom: "1px solid #e3beb8",
  padding: "0.5rem 0",
  fontFamily: "Manrope, sans-serif",
  fontSize: "16px",
  color: "#261816",
  outline: "none",
  transition: "border-color 0.3s ease",
};

function AtelierField({
  id, label, type = "text", value, onChange, placeholder, required,
}: {
  id: string; label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "#261816" }} htmlFor={id}>
        {label}{required && <span style={{ color: "#8B0000" }}> *</span>}
      </label>
      <input
        id={id} type={type} value={value} placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...inputStyle, borderBottomColor: focused ? "#C5A059" : "#e3beb8" }}
      />
    </div>
  );
}

export default function CustomerAddressesPage() {
  const { status } = useAuth();
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [form, setForm] = useState<AddressFormState>(() => createEmptyForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{title:string; message:string; danger?:boolean; onConfirm:()=>void} | null>(null);

  const loadAddresses = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<CustomerAddress[]>("/users/me/addresses");
    if (!result.success) {
      setError(result.message ?? "Không thể tải danh sách địa chỉ.");
      setLoading(false);
      return;
    }
    setAddresses(result.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void loadAddresses();
  }, [loadAddresses, status]);

  function handleResolvedAddress(address: ResolvedAddress | null) {
    if (!address) {
      return;
    }

    setForm((current) => ({
      ...current,
      line1: address.fullAddress || current.line1,
      district: address.district ?? current.district,
      city: address.province ?? current.city,
      latitude: address.latitude ?? current.latitude,
      longitude: address.longitude ?? current.longitude,
    }));
  }

  function startEdit(address: CustomerAddress) {
    setForm({
      receiverName: address.receiverName,
      phone: address.phone,
      line1: address.line1,
      ward: address.ward ?? "",
      district: address.district ?? "",
      city: address.city ?? "",
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
      isDefault: address.isDefault,
    });
    setEditingId(address.id);
    setMessage(null);
    setError(null);
  }

  function cancelEdit() {
    setForm(createEmptyForm());
    setEditingId(null);
    setMessage(null);
    setError(null);
  }

  async function handleUpdateAddress() {
    if (!editingId) return;
    setError(null);
    setMessage(null);
    setSaving(true);

    try {
      const result = await apiRequest<CustomerAddress>(`/users/me/addresses/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          receiverName: form.receiverName.trim(),
          phone: form.phone.trim(),
          line1: form.line1.trim(),
          ward: normalizeNullableText(form.ward),
          district: normalizeNullableText(form.district),
          city: normalizeNullableText(form.city),
          latitude: form.latitude,
          longitude: form.longitude,
          isDefault: form.isDefault,
        }),
      });

      if (!result.success || !result.data) {
        setError(result.message ?? "Không thể cập nhật địa chỉ.");
        return;
      }

      setForm(createEmptyForm());
      setEditingId(null);
      setMessage("Cập nhật địa chỉ thành công.");
      await loadAddresses();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAddress(id: string) {
    setError(null);
    setDeletingId(id);

    try {
      const result = await apiRequest<{ deleted: boolean }>(`/users/me/addresses/${id}`, {
        method: "DELETE",
      });

      if (!result.success) {
        setError(result.message ?? "Không thể xóa địa chỉ.");
        return;
      }

      setMessage("Xóa địa chỉ thành công.");
      await loadAddresses();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);

    try {
      const result = await apiRequest<CustomerAddress>("/users/me/addresses", {
        method: "POST",
        body: JSON.stringify({
          receiverName: form.receiverName.trim(),
          phone: form.phone.trim(),
          line1: form.line1.trim(),
          ward: normalizeNullableText(form.ward),
          district: normalizeNullableText(form.district),
          city: normalizeNullableText(form.city),
          latitude: form.latitude,
          longitude: form.longitude,
          isDefault: form.isDefault,
        }),
      });

      if (!result.success || !result.data) {
        setError(result.message ?? "Không thể lưu địa chỉ.");
        return;
      }

      setForm(createEmptyForm());
      setMessage("Thêm địa chỉ thành công.");
      await loadAddresses();
    } finally {
      setSaving(false);
    }
  }

  function formatAddress(address: CustomerAddress) {
    return [address.line1, address.ward, address.district, address.city].filter(Boolean).join(", ");
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-10 border-b pb-6" style={{ borderColor: "#e3beb8" }}>
        <h1 className="text-3xl font-semibold md:text-4xl" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
          Địa Chỉ Nhận Đồ
        </h1>
        <p className="mt-2 text-base" style={{ color: "#5a403c" }}>
          Quản lý các địa chỉ giao nhận trang phục thuê của bạn.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">

        {/* Left: Saved Addresses (5 cols) */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          <h2 className="text-2xl font-semibold" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
            Địa chỉ đã lưu
          </h2>

          {loading && (
            <p className="text-sm" style={{ color: "#5a403c" }}>Đang tải...</p>
          )}

          {!loading && addresses.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "#e3beb8" }}>
              <MapPinOff className="mx-auto h-9 w-9 opacity-40 mb-2" style={{ color: "#8B0000" }} />
              <p className="mt-2 text-sm" style={{ color: "#5a403c" }}>Chưa có địa chỉ nào được lưu.</p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {addresses.map((address) => (
              <div
                key={address.id}
                className="group relative overflow-hidden rounded-xl border p-6 transition-colors duration-200"
                style={{
                  backgroundColor: address.isDefault ? "#ffffff" : "transparent",
                  borderColor: "#e3beb8",
                  boxShadow: address.isDefault ? "0 2px 12px rgba(74,4,4,0.06)" : "none",
                }}
              >
                {/* Default badge */}
                {address.isDefault && (
                  <div className="absolute right-0 top-0 rounded-bl-xl border-b border-l px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: "#ffe9e6", borderColor: "#e3beb8", color: "#8B0000" }}>
                    Mặc định
                  </div>
                )}

                <div className="mb-3 flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "#261816" }}>
                    {address.receiverName}
                  </span>
                  <span className="text-sm" style={{ color: "#5a403c" }}>{address.phone}</span>
                </div>

                <p className="text-sm leading-relaxed" style={{ color: "#5a403c" }}>
                  {formatAddress(address)}
                </p>

                {/* Hover actions */}
                <div className="mt-4 flex gap-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <button
                    type="button"
                    className="text-[11px] font-bold uppercase tracking-wider transition-colors"
                    style={{ color: "#7b5800" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#8B0000"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#7b5800"; }}
                    onClick={() => startEdit(address)}
                  >
                    Chỉnh sửa
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-bold uppercase tracking-wider transition-colors"
                    style={{ color: "#5a403c" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ba1a1a"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#5a403c"; }}
                    disabled={deletingId === address.id}
                    onClick={() => setConfirmDialog({
                      title: "Xóa địa chỉ",
                      message: "Bạn có chắc muốn xóa địa chỉ này?",
                      danger: true,
                      onConfirm: () => handleDeleteAddress(address.id),
                    })}
                  >
                    {deletingId === address.id ? "Đang xoá..." : "Xoá"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Add New Address Form (7 cols) */}
        <div className="lg:col-span-7">
          <div className="rounded-xl border p-6 md:p-8"
            style={{ backgroundColor: "#ffffff", borderColor: "#e3beb8", boxShadow: "0 2px 12px rgba(74,4,4,0.04)" }}>
            <h2 className="mb-6 text-2xl font-semibold" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
              {editingId ? "Chỉnh Sửa Địa Chỉ" : "Thêm Địa Chỉ Mới"}
            </h2>

            <form onSubmit={(e) => { e.preventDefault(); if (editingId) { void handleUpdateAddress(); } else { void handleSubmit(e); } }} className="flex flex-col gap-6">
              {/* Row 1: Receiver + Phone */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <AtelierField id="receiverName" label="Tên người nhận" required
                  value={form.receiverName} placeholder="Nhập họ và tên"
                  onChange={(v) => setForm((c) => ({ ...c, receiverName: v }))} />
                <AtelierField id="phone" label="SĐT người nhận" type="tel" required
                  value={form.phone} placeholder="Nhập số điện thoại"
                  onChange={(v) => setForm((c) => ({ ...c, phone: v }))} />
              </div>

              <div className="rounded-xl border border-dashed p-4" style={{ borderColor: "#e3beb8", backgroundColor: "#fff8f6" }}>

                <AddressAutocomplete value={null} onChange={handleResolvedAddress} disabled={saving} />
              </div>

              {/* Row 2: Address Line */}
              <AtelierField id="line1" label="Địa chỉ cụ thể" required
                value={form.line1} placeholder="Số nhà, tên đường, tòa nhà..."
                onChange={(v) => setForm((c) => ({ ...c, line1: v }))} />

              {/* Row 3: Ward / District / City */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <AtelierField id="city" label="Tỉnh/Thành phố"
                  value={form.city} placeholder="TP. Hồ Chí Minh"
                  onChange={(v) => setForm((c) => ({ ...c, city: v }))} />
                <AtelierField id="district" label="Quận/Huyện"
                  value={form.district} placeholder="Quận 1"
                  onChange={(v) => setForm((c) => ({ ...c, district: v }))} />
                <AtelierField id="ward" label="Phường/Xã"
                  value={form.ward} placeholder="Phường Bến Thành"
                  onChange={(v) => setForm((c) => ({ ...c, ward: v }))} />
              </div>

              {/* Default checkbox */}
              <div className="flex items-center gap-3 pt-2">
                <input
                  id="isDefault"
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm((c) => ({ ...c, isDefault: e.target.checked }))}
                  className="h-5 w-5 cursor-pointer rounded"
                  style={{ accentColor: "#8B0000" }}
                />
                <label htmlFor="isDefault" className="cursor-pointer select-none text-base" style={{ color: "#261816" }}>
                  Đặt làm địa chỉ mặc định
                </label>
              </div>

              {/* Messages */}
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}
              {message && (
                <p className="rounded-lg border px-4 py-3 text-sm"
                  style={{ borderColor: "#C5A059", color: "#6E5E40", backgroundColor: "#fff8f0" }}>
                  ✓ {message}
                </p>
              )}

              {/* Submit */}
              <div className="flex justify-end gap-3 pt-2">
                {editingId ? (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-xl border px-6 py-3 text-[13px] font-semibold uppercase tracking-wider transition-all duration-200"
                    style={{ borderColor: "#e3beb8", color: "#5a403c" }}
                  >
                    Huỷ
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl px-8 py-3 text-[13px] font-semibold uppercase tracking-wider text-white transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: "#8B0000" }}
                >
                  {saving ? "Đang lưu..." : editingId ? "Cập nhật địa chỉ" : "Lưu địa chỉ mới"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <ConfirmModal open={!!confirmDialog} title={confirmDialog?.title??""} message={confirmDialog?.message??""} danger={confirmDialog?.danger} onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />
    </div>
  );
}
