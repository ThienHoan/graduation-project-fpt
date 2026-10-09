import { ManagerPortalShell } from "@/components/heritage/ui";
import { ProductStatsClient } from "./product-stats-client";

export const metadata = {
  title: "Hiệu quả sản phẩm | Cổ Phục ERP",
};

export default function ProductStatsPage() {
  return (
    <ManagerPortalShell
      active="product-stats"
      title="Hiệu quả sản phẩm"
      subtitle="Sản phẩm HOT, sản phẩm ít được thuê và đề xuất xử lý"
    >
      <ProductStatsClient />
    </ManagerPortalShell>
  );
}
