"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Loader2, Package, Shirt } from "lucide-react";
import { getMyIncidents, type MyIncidentBooking, type MyIncidentsResponse } from "@/lib/api";
import { STATUS_LABELS, incidentStatusOf, statusBadgeClass } from "@/lib/status-labels";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10).split("-").reverse().join("/");
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes} phút ${safe % 60} giây`;
}

function IncidentKindIcon({ kind }: { kind: MyIncidentBooking["incidents"][number]["itemKind"] }) {
  return kind === "garment" ? (
    <Shirt className="h-4 w-4 text-stone-400" />
  ) : (
    <Package className="h-4 w-4 text-stone-400" />
  );
}

export default function CustomerIncidentsPage() {
  const [data, setData] = useState<MyIncidentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getMyIncidents();
    if (!res.success || !res.data) {
      setError(res.message ?? "Không tải được danh sách sự cố.");
      setData(null);
      setLoading(false);
      return;
    }
    setError(null);
    setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bookings = data?.bookings ?? [];

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-sand bg-white p-6 shadow-xs sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">Tài khoản · Sự cố</p>
        <h1 className="mt-2 font-display text-3xl text-ink">Sự cố cần xử lý</h1>
        <p className="mt-2 text-sm leading-7 text-stone-600">
          Các đơn thuê có món không còn sẵn sàng cho lịch thuê. Bạn có thể chọn mẫu thay thế, bỏ món hoặc huỷ đơn
          trước ngày nhận đồ.
        </p>
        {!loading && !error ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {data && data.count > 0
              ? `${data.count} đơn đang có sự cố (${data.incidentCount} món)`
              : "Không có sự cố nào"}
          </div>
        ) : null}
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-sand bg-white py-16 text-sm text-stone-500">
          <Loader2 className="h-5 w-5 animate-spin text-lotus" />
          Đang tải danh sách sự cố...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-sand bg-white px-6 py-16 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-jade" />
          <h2 className="mt-4 font-display text-2xl text-ink">Mọi thứ đã sẵn sàng</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-stone-600">
            Hiện không có đơn thuê nào cần đổi mẫu hay bỏ món. Khi cửa hàng phát hiện món không sẵn sàng, sự cố sẽ
            xuất hiện tại đây.
          </p>
          <Link
            href="/dashboard/customer"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-lotus px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-oxblood"
          >
            Về đơn thuê của tôi
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => {
            const bookingStatus = STATUS_LABELS[booking.bookingStatus];
            return (
              <section
                key={booking.bookingId}
                className="overflow-hidden rounded-2xl border border-sand bg-white shadow-xs"
              >
                <header className="flex flex-col gap-3 border-b border-sand bg-mist/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-display text-xl text-ink">Đơn #{booking.bookingCode}</p>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-stone-500">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(booking.rentalStartDate)} – {formatDate(booking.rentalEndDate)}
                    </p>
                  </div>
                  {bookingStatus ? (
                    <span className={statusBadgeClass(bookingStatus.color)}>{bookingStatus.label}</span>
                  ) : null}
                </header>

                <ul className="divide-y divide-sand/70">
                  {booking.incidents.map((incident) => {
                    const st = incidentStatusOf(incident.status);
                    return (
                      <li key={incident.id} className="flex items-start gap-3 px-5 py-4">
                        {incident.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={incident.imageUrl}
                            alt={incident.name ?? "Món bị sự cố"}
                            className="h-12 w-12 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-mist text-stone-400">
                            <IncidentKindIcon kind={incident.itemKind} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-ink">
                            {incident.name ?? (incident.itemKind === "garment" ? "Trang phục" : "Phụ kiện")}
                            {incident.sizeLabel ? ` · size ${incident.sizeLabel}` : ""}
                          </p>
                          <p className="mt-0.5 text-sm text-stone-600">Lý do: {incident.reasonLabel}</p>
                          <span className={`mt-2 inline-block ${statusBadgeClass(st.color)}`}>{st.label}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <footer className="flex flex-col gap-3 border-t border-sand px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-stone-500">
                    {booking.pendingRequest
                      ? booking.pendingRequest.requiresHold
                        ? `Bạn đang có yêu cầu đổi chờ xác nhận — giữ chỗ còn ${formatCountdown(
                            booking.pendingRequest.countdownSeconds,
                          )}.`
                        : "Bạn đang có yêu cầu bỏ món chờ xác nhận."
                      : "Chọn mẫu thay thế, bỏ món hoặc huỷ đơn cho các món bị sự cố."}
                  </p>
                  <Link
                    href={`/booking/incidents/${encodeURIComponent(booking.bookingId)}`}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-lotus px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-oxblood"
                  >
                    Xử lý sự cố
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </footer>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
