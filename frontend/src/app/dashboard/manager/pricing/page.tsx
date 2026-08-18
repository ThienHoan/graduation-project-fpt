import { ManagerPortalShell } from "@/components/heritage/ui";
import { PricingManagerClient } from "./pricing-manager-client";

export const metadata = {
  title: "Điều chỉnh giá | Cổ Phục ERP",
};

export default function PricingManagerPage() {
  return (
    <ManagerPortalShell
      active="pricing"
      title="Điều chỉnh giá"
      subtitle="Quản lý lịch sự kiện, đề xuất giá AI và khoảng giá hiệu lực"
    >
      <div className="space-y-6">
        <PricingManagerClient />
      </div>
    </ManagerPortalShell>
  );
}