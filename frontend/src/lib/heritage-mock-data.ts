export type CatalogGarment = {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  era: string;
  dailyPrice: string;
  deposit: string;
  size: string;
  status: string;
  description: string;
  image: string;
  detailImages: string[];
};

export const catalogFilters = ["Loại y phục", "Kích thước", "Màu sắc", "Sự kiện"];

export const catalogGarments: CatalogGarment[] = [
  {
    slug: "nhat-binh-hoang-phai",
    title: "Nhật Bình Hoàng Phái",
    subtitle: "Tiêu điểm lưu trữ",
    category: "Cung đình",
    era: "Triều Nguyễn",
    dailyPrice: "1.200.000đ / ngày",
    deposit: "3.500.000đ",
    size: "M",
    status: "Sẵn sàng cho thuê",
    description:
      "Tái hiện nguyên bản y phục của bậc hậu phi triều Nguyễn với tơ tằm đỏ, thêu thủ công họa tiết rồng phượng và đường viền ngũ sắc sang trọng.",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDvowMvVYvat40td0eYsm2xOyewRYASe82qkNdpYOhmlGpLtvo-CY1thuEj3H0Ex3taiVfLTKX2ESAQ9rvq13OU7L69H-IJ4iocVq83idHbhAPZHBmozXmdoLqEf5PfXNcZXs7Uz2YmawbQoZwfIPGjesRNPzDQS18JSZs6OvqnDYS1j1ExtTh4ACDttytuJ5mfuT_RDObouB5E1zhQh92zf6X9GOwGBGbQXQXDpLMIfe9reSHCU63uycTGSdtwAwLtouKipe_UVc2k",
    detailImages: [
      "https://lh3.googleusercontent.com/aida/AP1WRLuW52zIUPG8s28NGtCZDox-IsYxTuydKP_K4rWuLOB5gdlIbvRy8-CQNiUTpxBOgVzlCIwzOIK5CJaNf_t1rMKqLDdnjDInRE0TNkAdMx6NI7c4eRsVAwhIP0ScRVOczYYBJVIeDilq85F_r-OAQt01_S6j_TMgwFkNP7Un6GJq5OuB8ZiGPluckIqInH7ZBKk1SVSbQzjYyyJs6sMyoV_Szs72Fh4piXP_iHDwm_elQjCRJvQJMbHn6Ds",
      "https://lh3.googleusercontent.com/aida-public/AB6AXuBVIBgokmYBeh3WWBQXNHIEsN-ajXa3P-XiktmgrY7bT3wqoiOcLpzeDqJgX1K1aUNflGOMBsEJiA-GL-iuBTN2GR1fQkBvIWn5SerTICxuAP4ZAaL2rt8tYCNrpxSJIdYZivweyu6vLkEr1QqSl2a76fGlrpuKv9kx7Bya65DNMyytax9JkvVFpumgbbeB4hPI2Rxp6fA22Jy4FcP6qOvosV2Nh-3wlKnsTuuSW9_hJaeAgvB1V6S-gZNvBeFh4wnnYCWN-qTuJgi2",
      "https://lh3.googleusercontent.com/aida-public/AB6AXuD5IRnzBLUP3VMDCNmNP_joL4_DKUSoY_tew06SKYfRjWIc3h5X8nP3zh8A4RLpxXF7oq579tknuysUFpBnqEJYXtbPxDhj1K_5pcDiduprs-Sz49JDTzPEpPxTJKWX8_88AEer60WJjk_vt0HfVDMHa5ChG2eEdwfIaLCv_pin6OZAVRSheyg20cCmgBmx1YafAlM-aNj9L2lUWZpcBIX7DM1SQOMY9wB0plav8FlrbMCQg8vLxZDDO3Jj3HpUmYNHB6PjocpwgCVm",
    ],
  },
  {
    slug: "ao-tac-lam-thuong",
    title: "Áo Tấc Lam Thượng",
    subtitle: "Sưu tập cung đình",
    category: "Áo Tấc",
    era: "Triều Nguyễn",
    dailyPrice: "800.000đ / ngày",
    deposit: "2.200.000đ",
    size: "M-L",
    status: "Có lịch trống",
    description:
      "Áo Tấc xanh lam trầm với cấu trúc đứng dáng, phù hợp chụp cổ trang, nghi lễ gia tiên và trình diễn văn hóa.",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O",
    detailImages: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuAp8QntSX86-npLy6GZhzDW3S6hDsmK_e0194JUyIehNfQKRhE9vUF35IBAk74jbWLnJDbSY5CxzXa9AfzYnepenhDwTtGl9GlAtITr3j_tYnhzVdMESPHHVvCtJMLH95tqwn1olV8v5veytJaiVZetmkvmHe6wgjJyNSG4p-2C5RF61y_YXkDUSeNIp-XWXYoHT4HyAdzpSJ0i9sKrzvlJPzxMibEHs2G9xKp4cMvVMV81eICncFd31Vq-S_G8HK8GEIPiOZ6dxl2O",
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCjQb3jdhWsM4S7W3nKLiwVF-7qlZFTty5hPzZ_lSDDMSwBxhzr-mbjH80b_wnRoqaIX_ndqhaLPmRPyV6Rtzj5MF6iPTQ1oNZ3BdWBN90yMRWVfNzcohMZf5Su6bpkibZURmFObBL069vDtVI0qiUwt3d2o7UhR0i_GfyepYyx6fSlgB1TqjGtSoQBL8PSghtmQa4Xk6dL26InmSgXaWWtdE0_zNghUst0izeja4VpLjz61KUgyNFcV_F90gVVypZ0kGIez9Q43x7N",
    ],
  },
  {
    slug: "ao-dai-phung-vu",
    title: "Áo Dài Phụng Vũ",
    subtitle: "Lễ phục cưới",
    category: "Áo dài cưới",
    era: "Đương đại phục dựng",
    dailyPrice: "1.500.000đ / ngày",
    deposit: "4.000.000đ",
    size: "S-M",
    status: "Đặt trước 3 ngày",
    description:
      "Thiết kế áo dài cưới thêu phụng vàng trên nền lụa ngà, phù hợp gia tiên, rước dâu và chụp ảnh studio.",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDS1o5lSmGpkTUXc5LH4apMFHlcKEbyL3m8Z8RgdQROFBvi-EDOwrPRIdNCQ9PXjHlWVZcnVBJitf0PhQPkfPCnb91euyVXyXmEjGH22LyYBCWx9tIZUtohpM8mddPADbGjhomL0P10yhDjoWJvUVy3zdHCEPBS6Jxc2dQXB9H04gP_Pc-tbIec8mGliSs3Ny9q-elFSPeu7fojwL3nKXsVaM970qq_IoiXasEdVlGaBNW-BdsVVcsi52wgkajLfqkJMTYSAX-fJaR9",
    detailImages: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDS1o5lSmGpkTUXc5LH4apMFHlcKEbyL3m8Z8RgdQROFBvi-EDOwrPRIdNCQ9PXjHlWVZcnVBJitf0PhQPkfPCnb91euyVXyXmEjGH22LyYBCWx9tIZUtohpM8mddPADbGjhomL0P10yhDjoWJvUVy3zdHCEPBS6Jxc2dQXB9H04gP_Pc-tbIec8mGliSs3Ny9q-elFSPeu7fojwL3nKXsVaM970qq_IoiXasEdVlGaBNW-BdsVVcsi52wgkajLfqkJMTYSAX-fJaR9",
      "https://lh3.googleusercontent.com/aida-public/AB6AXuAKu0UsDTI85vd0L9dFyAgQQV1wb__bOoneZVrH1VhUB-TxYdc0ycyxzhuraqBgRHPPppHbLJN0PzldLW25EyRtrt6cpa9T_dRvPknMTO6IpLKVdATAGei_UsyyOs9l3yatVZscxpVAb6fwLq1FvK3cHWFnnaiJh5SIEbSJ8LuZZQ0K5xfoAVzgGd5Gxl9OrNf5QBOZXfBF9f_j3CboSC8SY1NAFgKqRpasg82xyCISAT9_MoxuQBVn9aLOkTqgHC5TCgND2w0L3gc6",
    ],
  },
  {
    slug: "ngu-than-cat-tuong",
    title: "Ngũ Thân Cát Tường",
    subtitle: "Trang phục nam",
    category: "Ngũ Thân",
    era: "Triều Nguyễn",
    dailyPrice: "900.000đ / ngày",
    deposit: "2.500.000đ",
    size: "L",
    status: "Sẵn sàng cho thuê",
    description:
      "Ngũ Thân nam tông trầm, phom cổ điển, phù hợp concept thư sinh hoặc lễ nghi truyền thống Việt Nam.",
    image:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCiRw5xBcp3CUYB_7F6wO-x89_PNnN-I0V_KyL_KlqnDnVnncJpeRnCiJikI8xexjD5P6Ho3hSCdc8YOetzS20DF7oUUKGt7QT3D_le4ZM36wdkrJp3I2gnIgucbIYTGQGu2zzFYEndMuSJrqDk9ufq9u2GGeVgFgGEqBcxHDC15WXXsRoGz4yXDrEBTXQlNs9jlFtLBf3kcO-myHVZPo2wPAyl9J0KAu_bbsVJOP-DaRxBiFb9rmvFp2RXG6Z2F5gaWBkIpzTiW3Yl",
    detailImages: [
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCiRw5xBcp3CUYB_7F6wO-x89_PNnN-I0V_KyL_KlqnDnVnncJpeRnCiJikI8xexjD5P6Ho3hSCdc8YOetzS20DF7oUUKGt7QT3D_le4ZM36wdkrJp3I2gnIgucbIYTGQGu2zzFYEndMuSJrqDk9ufq9u2GGeVgFgGEqBcxHDC15WXXsRoGz4yXDrEBTXQlNs9jlFtLBf3kcO-myHVZPo2wPAyl9J0KAu_bbsVJOP-DaRxBiFb9rmvFp2RXG6Z2F5gaWBkIpzTiW3Yl",
    ],
  },
];

export const garmentSpecs = [
  { label: "Chất liệu", value: "Tơ tằm / gấm phục dựng" },
  { label: "Kỹ thuật", value: "Thêu tay thủ công" },
  { label: "Tình trạng", value: "Xuất sắc / gần như mới" },
  { label: "Niên đại tham chiếu", value: "Triều Nguyễn, thế kỷ XIX" },
];

export const pairingItems = [
  {
    title: "Khăn đóng vàng",
    price: "+ 200.000đ / ngày",
    image:
      "https://lh3.googleusercontent.com/aida/AP1WRLsQQAUgD88ACQDVhZA3WnhFnlPEB8Chr4c0g2zIZGmaEyLNs5g2BCaGRoH54EoV9yvV2MiWYKy5BJlkNdy3X8zhmkS_OZMW7PucWbxxrPA5XONQHutPZfqEoNQfCP2PK4XylkqzXtP_DWORxdUFK0gONyAImXtT826ISbQtvzPhDRy5p8tENnunh0oXJcJh-Zi7JJfx230iU-ZEQNYSffg9FR3cpC_AicrXeMTPwPGhKdg5jfj7m2vJqFbM",
  },
  {
    title: "Bộ trang sức ngọc",
    price: "+ 350.000đ / ngày",
    image:
      "https://lh3.googleusercontent.com/aida/AP1WRLsQQAUgD88ACQDVhZA3WnhFnlPEB8Chr4c0g2zIZGmaEyLNs5g2BCaGRoH54EoV9yvV2MiWYKy5BJlkNdy3X8zhmkS_OZMW7PucWbxxrPA5XONQHutPZfqEoNQfCP2PK4XylkqzXtP_DWORxdUFK0gONyAImXtT826ISbQtvzPhDRy5p8tENnunh0oXJcJh-Zi7JJfx230iU-ZEQNYSffg9FR3cpC_AicrXeMTPwPGhKdg5jfj7m2vJqFbM",
  },
];

export const bookingFlowSteps = [
  // href của "garment" không dùng slug mock — trỏ về /catalog để user chọn trang phục thật từ DB
  { key: "garment", label: "Trang phục", icon: "checkroom", href: "/catalog" },
  { key: "schedule", label: "Lịch thuê", icon: "calendar_today", href: "/booking/date-selection" },
  { key: "logistics", label: "Vận chuyển", icon: "local_shipping", href: "/booking/logistics" },
  { key: "review", label: "Kiểm tra đơn", icon: "fact_check", href: "/booking/review" },
  { key: "confirm", label: "Hoàn tất", icon: "verified", href: "/booking/success" },
];

export const bookingSelection = {
  garment: catalogGarments[0],
  rentalDates: "14/09/2024 - 16/09/2024",
  duration: "3 ngày",
  rentalFee: "3.600.000đ",
  serviceFee: "400.000đ",
  deposit: "5.000.000đ",
  totalToday: "4.000.000đ",
  grandTotal: "8.600.000đ",
};

export const logisticsMethods = [
  {
    key: "store_pickup",
    title: "Nhận tại xưởng",
    description: "Bao gồm buổi thử nhanh và bàn giao trực tiếp với nhân viên.",
    icon: "storefront",
  },
  {
    key: "delivery",
    title: "Giao tận nơi",
    description: "Đóng gói cẩn thận, giao nhận theo khung giờ đã hẹn.",
    icon: "local_shipping",
  },
];

export const customerTimeline = [
  { title: "Đặt lịch thành công", note: "Đã xác nhận thanh toán cọc.", state: "done" },
  { title: "Đang chuẩn bị", note: "Nghệ nhân kiểm tra và là phẳng trang phục.", state: "active" },
  { title: "Sẵn sàng nhận đồ", note: "Hệ thống sẽ gửi thông báo khi hoàn tất.", state: "todo" },
  { title: "Đang thuê", note: "Theo dõi xuyên suốt trong bảng điều khiển khách hàng.", state: "todo" },
];

export const customerOrderHistory = [
  { title: "Áo Tấc Lam Thượng", period: "10/09/2024 - 12/09/2024", status: "Hoàn tất", image: catalogGarments[1].image },
  { title: "Áo Dài Sen Trắng", period: "05/08/2024 - 06/08/2024", status: "Hoàn tất", image: "https://lh3.googleusercontent.com/aida-public/AB6AXuAKu0UsDTI85vd0L9dFyAgQQV1wb__bOoneZVrH1VhUB-TxYdc0ycyxzhuraqBgRHPPppHbLJN0PzldLW25EyRtrt6cpa9T_dRvPknMTO6IpLKVdATAGei_UsyyOs9l3yatVZscxpVAb6fwLq1FvK3cHWFnnaiJh5SIEbSJ8LuZZQ0K5xfoAVzgGd5Gxl9OrNf5QBOZXfBF9f_j3CboSC8SY1NAFgKqRpasg82xyCISAT9_MoxuQBVn9aLOkTqgHC5TCgND2w0L3gc6" },
];

export const customerWidgets = [
  {
    title: "Lịch sử thử đồ AI",
    description: "Xem lại các phiên bản thử trang phục kỹ thuật số gần đây.",
    icon: "face_retouching_natural",
    accent: "bg-lotus/10 text-lotus",
    href: "/try-on",
  },
  {
    title: "Số đo cá nhân",
    description: "Cập nhật chiều cao, vòng ngực và ghi chú chỉnh sửa trước lần thuê tiếp theo.",
    icon: "straighten",
    accent: "bg-bronze/10 text-bronze",
    href: "/dashboard/customer/measurements",
  },
  {
    title: "Địa chỉ nhận đồ",
    description: "Nhà riêng tại Quận 1 đang được dùng làm địa chỉ mặc định cho đơn thuê.",
    icon: "location_on",
    accent: "bg-antique/10 text-antique",
    href: "/dashboard/customer/addresses",
  },
];

export const staffStats = [
  { label: "Giao hôm nay", value: "12", note: "Đã giao 4", accent: "text-jade bg-jade/10" },
  { label: "Nhận lại hôm nay", value: "08", note: "Chờ 6", accent: "text-slate-600 bg-slate-100" },
  { label: "Quá hạn", value: "03", note: "Cần xử lý", accent: "text-red-700 bg-red-100" },
  { label: "Đơn mới", value: "05", note: "+2 giờ trước", accent: "text-antique bg-antique/10" },
];

export const staffScheduleRows = [
  { code: "#ORD-892", customer: "Phạm Minh Hoàng", product: "Nhật Bình Hoàng Phái (M)", type: "Giao hàng", action: "Đã giao" },
  { code: "#ORD-890", customer: "Nguyễn Thị Mai", product: "Áo Tấc Đỏ Đun (S)", type: "Nhận lại", action: "Đã nhận lại" },
];

export const pendingRequests = [
  { code: "#REQ-1024", garment: "Áo Giao Lĩnh Xanh Lục (L)", customer: "Trần Văn A", period: "26/10 - 28/10" },
];

export const lifecycleCards = [
  { title: "Đang kiểm tra", note: "Sau khi trả", value: "04", color: "text-amber-700 bg-amber-50" },
  { title: "Đang giặt sấy", note: "Bảo dưỡng định kỳ", value: "12", color: "text-slate-600 bg-slate-100" },
  { title: "Cần sửa chữa", note: "Hư hỏng nhẹ", value: "02", color: "text-orange-700 bg-orange-50" },
];

export const inspectionChecklist = [
  {
    title: "Độ sạch bề mặt",
    description: "Kiểm tra vết bẩn, mùi lạ hoặc nước đọng trên các mảng lụa chính.",
  },
  {
    title: "Tình trạng thêu đính",
    description: "Xem kỹ chỉ kim tuyến, cổ áo và tay áo có bị bung hoặc xước hay không.",
  },
  {
    title: "Đường may & cấu trúc",
    description: "Kiểm tra nách, sườn áo và các điểm chịu lực có bị rách hay bai không.",
  },
  {
    title: "Phụ kiện đi kèm",
    description: "Xác nhận đủ khuy đồng, khăn đóng và chi tiết đi kèm như biên bản bàn giao.",
  },
];

export const inspectionPhotos = [
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBGXKm-yY-1I1adHk0lE1ENVQsZmVvyVTc_ourfqt9hb-vtQcNMCGV4cKv51kISoAoMLWD_Wl04kVsAmRr-sLocFojxZ6lg2efPwxCEk8GMHnAJJRmA5T-S7Lhk0DIP769tymGY3CD1WBheALuzNqr1jJod6mwzyCjnXDlspwo0q9HmbjsKOhEI0WrHrU_EamZ0qSuFyNqnmN00HqlsQIsxtuL5TlZAanhXi0C0pmxJq_vFwT4y1L-BmZrOIT0RlBNxFOxbB6UWH_M_",
];

export const bookingSuccessTimeline = [
  {
    title: "Xưởng xác nhận đơn",
    description: "Nhân viên kiểm tra lịch trống, số đo và tình trạng bộ đồ trong vòng 30 phút.",
  },
  {
    title: "Chuẩn bị & hoàn thiện",
    description: "Trang phục được là phẳng, kiểm tra khuy, đóng gói và gắn phiếu tài sản trước khi bàn giao.",
  },
  {
    title: "Bàn giao theo lịch hẹn",
    description: "Bạn nhận đồ tại atelier hoặc qua dịch vụ giao nhận đã chọn trong bước logistics.",
  },
];

export function getGarmentBySlug(slug: string) {
  return catalogGarments.find((item) => item.slug === slug);
}
