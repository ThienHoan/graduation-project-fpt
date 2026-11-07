import { ManagerPortalShell } from "@/components/heritage/ui";
import { CustomerCareClient } from "./customer-care-client";

export const metadata = {
  title: "Chăm sóc & Nhắc lịch | Cổ Phục ERP",
};

export default function CustomerCarePage() {
  return (
    <ManagerPortalShell
      active="customer-care"
      title="Trung tâm Chăm sóc Khách hàng & Tự động hóa"
      subtitle="Giám sát thông báo nhắc lịch, quản lý đơn cần hỗ trợ, xem trước mẫu email & chính sách tri ân"
    >
      <CustomerCareClient />
    </ManagerPortalShell>
  );
}

