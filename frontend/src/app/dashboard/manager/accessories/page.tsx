import { ManagerPortalShell } from "@/components/heritage/ui";
import { AccessoriesManagerClient } from "./accessories-manager-client";

export const metadata = {
  title: "Kho phụ kiện | Cổ Phục ERP",
};

export default function AccessoriesManagerPage() {
  return (
    <ManagerPortalShell
      active="accessories"
      title="Kho phụ kiện"
      subtitle="Quản lý danh mục phụ kiện và từng món tài sản vật lý"
    >
      <div className="space-y-6">
        <AccessoriesManagerClient />
      </div>
    </ManagerPortalShell>
  );
}
