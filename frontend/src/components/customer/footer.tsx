import Link from "next/link";

export function CustomerFooter() {
  return (
    <footer className="bg-oxblood px-4 py-16 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
          {/* Column 1: Brand */}
          <div>
            <Link href="/" className="font-display text-3xl text-white">
              Cổ Phục Rental
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/60">
              Bảo tồn Di sản Việt qua Sự Xuất sắc Hiện đại. Trang phục truyền thống được tuyển chọn
              và bảo quản theo tiêu chuẩn bảo tàng.
            </p>
          </div>

          {/* Column 2: Danh mục */}
          <div>
            <h4 className="font-display text-lg text-antique">Danh mục</h4>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link href="/catalog" className="text-sm text-white/70 transition hover:text-white">
                  Bộ sưu tập
                </Link>
              </li>
              <li>
                <Link href="/try-on" className="text-sm text-white/70 transition hover:text-white">
                  Thử đồ AI
                </Link>
              </li>
              <li>
                <Link href="/booking/date-selection" className="text-sm text-white/70 transition hover:text-white">
                  Đặt lịch thuê
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Hỗ trợ */}
          <div>
            <h4 className="font-display text-lg text-antique">Hỗ trợ</h4>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link href="/dashboard/customer" className="text-sm text-white/70 transition hover:text-white">
                  Dashboard khách hàng
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("chat:open"));
                  }}
                  className="text-left text-sm text-white/70 transition hover:text-white"
                >
                  Chăm sóc khách hàng
                </button>
              </li>
              <li>
                <a href="#" className="text-sm text-white/70 transition hover:text-white">
                  Chính sách thuê &amp; hoàn trả
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-center">
          <p className="text-xs text-white/40">
            © 2024 Cổ Phục Rental. Bảo tồn Di sản Việt qua Sự Xuất sắc Hiện đại.
          </p>
        </div>
      </div>
    </footer>
  );
}
