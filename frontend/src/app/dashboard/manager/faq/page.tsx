import { ManagerPortalShell } from "@/components/heritage/ui";
import { FaqManagerClient } from "./faq-manager-client";

export const metadata = {
  title: "Cấu hình FAQ | Cổ Phục ERP",
};

export default function FaqManagerPage() {
  return (
    <ManagerPortalShell
      active="faq"
      title="Cấu hình FAQ CSKH"
      subtitle="Nội dung shop tự động trả lời khách — chỉ dùng giá trị do chủ shop cung cấp"
    >
      <FaqManagerClient />
    </ManagerPortalShell>
  );
}
