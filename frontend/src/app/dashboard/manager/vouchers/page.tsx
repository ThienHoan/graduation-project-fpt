import { ManagerPortalShell } from "@/components/heritage/ui";
import { VouchersManagerClient } from "./vouchers-manager-client";

export const metadata = {
  title: "Voucher & khuyến mãi | Cổ Phục ERP",
};

export default function VouchersManagerPage() {
  return (
    <ManagerPortalShell
      active="vouchers"
      title="Voucher & khuyến mãi"
      subtitle="Tạo mã giảm giá, giới hạn lượt dùng, điều kiện đơn tối thiểu và nhóm sản phẩm áp dụng"
    >
      <VouchersManagerClient />
    </ManagerPortalShell>
  );
}
