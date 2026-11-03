"use client";

import { useRouter } from "next/navigation";
import { StaffPortalShell } from "@/components/heritage/ui";
import { StaffOverviewTab } from "@/components/dashboard/staff/staff-overview-tab";

export default function StaffOverviewPage() {
  const router = useRouter();

  return (
    <StaffPortalShell
      active="overview"
      title="Tổng quan ca trực"
      subtitle="Bảng điều khiển vận hành, hiện vật và lịch trình trong ngày."
      onTabChange={(key) => {
        if (key === "overview") return;
        if (key === "all" || key === "pending" || key === "map" || key === "refunds") {
          router.push(`/dashboard/staff/booking#${key}`);
        } else if (key === "inspection") {
          router.push("/dashboard/staff/inspection");
        } else if (key === "reviews") {
          router.push("/dashboard/staff/reviews");
        } else if (key === "chat") {
          router.push("/chat");
        }
      }}
    >
      <StaffOverviewTab
        onSwitchTab={(targetTab, filterStatus) => {
          if (filterStatus) {
            router.push(`/dashboard/staff/booking?status=${filterStatus}#${targetTab}`);
          } else {
            router.push(`/dashboard/staff/booking#${targetTab}`);
          }
        }}
        onSelectBooking={(id) => {
          router.push(`/dashboard/staff/booking/${id}`);
        }}
      />
    </StaffPortalShell>
  );
}
