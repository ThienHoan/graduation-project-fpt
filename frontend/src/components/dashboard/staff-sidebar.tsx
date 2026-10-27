"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Clock,
  Map,
  ClipboardCheck,
  RotateCcw,
  Star,
  MessageSquare,
  Headphones,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { StaffChatNavBadge } from "@/components/chat/staff-chat-nav-badge";
import type { StaffNavKey } from "@/components/heritage/ui";

export interface StaffNavItemConfig {
  key: StaffNavKey;
  label: string;
  icon: LucideIcon;
  href: string;
  badge?: "chat";
}

export interface StaffNavGroupConfig {
  id: string;
  title: string;
  icon: LucideIcon;
  items: StaffNavItemConfig[];
}

export const STAFF_NAV_GROUPS: StaffNavGroupConfig[] = [
  {
    id: "operations",
    title: "Vận hành & Đơn hàng",
    icon: Layers,
    items: [
      { key: "all", label: "Tất cả đơn thuê", icon: LayoutDashboard, href: "/dashboard/staff#all" },
      { key: "pending", label: "Chờ xác nhận", icon: Clock, href: "/dashboard/staff#pending" },
      { key: "map", label: "Bản đồ giao nhận", icon: Map, href: "/dashboard/staff#map" },
    ],
  },
  {
    id: "logistics",
    title: "Kiểm tra & Hậu cần",
    icon: ClipboardCheck,
    items: [
      { key: "inspection", label: "Kiểm tra hiện vật", icon: ClipboardCheck, href: "/dashboard/staff/inspection" },
      { key: "refunds", label: "Xử lý hoàn cọc", icon: RotateCcw, href: "/dashboard/staff#refunds" },
    ],
  },
  {
    id: "services",
    title: "Dịch vụ & Khách hàng",
    icon: MessageSquare,
    items: [
      { key: "reviews", label: "Đánh giá", icon: Star, href: "/dashboard/staff/reviews" },
      { key: "chat", label: "CSKH & Tin nhắn", icon: MessageSquare, href: "/chat", badge: "chat" },
    ],
  },
];

interface StaffSidebarProps {
  active: StaffNavKey;
  onTabChange?: (key: StaffNavKey) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  effectiveName: string;
  effectiveEmail: string | null;
  initials: string;
  onProfile: () => void;
  onSignOut: () => void;
  isMobileDrawer?: boolean;
  onCloseMobileDrawer?: () => void;
}

export function StaffSidebar({
  active,
  onTabChange,
  isCollapsed,
  onToggleCollapse,
  effectiveName,
  effectiveEmail,
  initials,
  onProfile,
  isMobileDrawer = false,
  onCloseMobileDrawer,
}: StaffSidebarProps) {
  const router = useRouter();

  // Accordion state
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    STAFF_NAV_GROUPS.forEach((group) => {
      const hasActive = group.items.some((item) => item.key === active);
      initial[group.id] = hasActive;
    });
    return initial;
  });

  // Keep active group open
  useEffect(() => {
    const activeGroup = STAFF_NAV_GROUPS.find((group) =>
      group.items.some((item) => item.key === active)
    );
    if (activeGroup) {
      setOpenGroups((prev) => ({
        ...prev,
        [activeGroup.id]: true,
      }));
    }
  }, [active]);

  const toggleGroup = useCallback((groupId: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }, []);

  // Flyout state when collapsed
  const [flyoutGroupId, setFlyoutGroupId] = useState<string | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ text: string; top: number; left: number } | null>(null);
  const tooltipTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = useCallback(
    (text: string, e: React.MouseEvent<HTMLElement>) => {
      if (isMobileDrawer || flyoutGroupId) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = setTimeout(() => {
        setTooltip({
          text,
          top: rect.top + rect.height / 2,
          left: rect.right + 10,
        });
      }, 250);
    },
    [isMobileDrawer, flyoutGroupId]
  );

  const hideTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip(null);
  }, []);

  // Close flyout on outside click or Escape
  useEffect(() => {
    if (!flyoutGroupId) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFlyoutGroupId(null);
      }
    }

    function handleMouseDown(e: MouseEvent) {
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(e.target as Node) &&
        activeTriggerRef.current &&
        !activeTriggerRef.current.contains(e.target as Node)
      ) {
        setFlyoutGroupId(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [flyoutGroupId]);

  const handleGroupIconClick = useCallback(
    (groupId: string, e: React.MouseEvent<HTMLButtonElement>) => {
      hideTooltip();
      if (flyoutGroupId === groupId) {
        setFlyoutGroupId(null);
        activeTriggerRef.current = null;
      } else {
        const rect = e.currentTarget.getBoundingClientRect();
        activeTriggerRef.current = e.currentTarget;
        const top = Math.max(16, Math.min(rect.top - 10, window.innerHeight - 300));
        setFlyoutPos({ top, left: rect.right + 12 });
        setFlyoutGroupId(groupId);
      }
    },
    [flyoutGroupId, hideTooltip]
  );

  const handleItemClick = useCallback(
    (item: StaffNavItemConfig, e?: React.MouseEvent) => {
      setFlyoutGroupId(null);
      hideTooltip();
      if (isMobileDrawer && onCloseMobileDrawer) {
        onCloseMobileDrawer();
      }

      const isHashTab =
        (item.href.includes("#") || item.href === "/dashboard/staff") &&
        item.key !== "chat";

      if (isHashTab && onTabChange) {
        if (e) e.preventDefault();
        onTabChange(item.key);
      } else {
        router.push(item.href);
      }
    },
    [isMobileDrawer, onCloseMobileDrawer, onTabChange, router, hideTooltip]
  );

  const handleInspectionClick = useCallback(() => {
    hideTooltip();
    if (isMobileDrawer && onCloseMobileDrawer) {
      onCloseMobileDrawer();
    }
    router.push("/dashboard/staff/inspection");
  }, [isMobileDrawer, onCloseMobileDrawer, router, hideTooltip]);

  const activeFlyoutGroup = STAFF_NAV_GROUPS.find((g) => g.id === flyoutGroupId);

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-sand/60 pb-3 pt-1">
          {!isCollapsed ? (
            <div className="min-w-0 pr-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lotus font-display text-base font-bold text-parchment shadow-xs">
                  CP
                </span>
                <div className="min-w-0">
                  <h1 className="font-display text-xl font-bold tracking-tight text-lotus truncate leading-tight">
                    Cổ Phục Rental
                  </h1>
                  <p className="text-[11px] font-medium text-stone-500 truncate">
                    Bảng vận hành nhân viên
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-lotus/10 border border-lotus/20 shadow-xs">
              <span className="font-display text-lg font-bold text-lotus">CP</span>
            </div>
          )}

          {/* Toggle / Close Button */}
          {isMobileDrawer ? (
            <button
              type="button"
              onClick={onCloseMobileDrawer}
              aria-label="Đóng thanh điều hướng"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-sand/40 hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            !isCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapse}
                onMouseEnter={(e) => showTooltip("Thu gọn thanh bên (250px ➔ 72px)", e)}
                onMouseLeave={hideTooltip}
                aria-label="Thu gọn thanh bên"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-white hover:text-lotus transition-colors shadow-xs border border-sand/40"
              >
                <PanelLeftClose className="h-4.5 w-4.5" />
              </button>
            )
          )}
        </div>

        {/* Collapsed Expand Button */}
        {!isMobileDrawer && isCollapsed && (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={onToggleCollapse}
              onMouseEnter={(e) => showTooltip("Mở rộng thanh bên", e)}
              onMouseLeave={hideTooltip}
              aria-label="Mở rộng thanh bên"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-white hover:text-lotus transition-colors shadow-xs border border-sand/50"
            >
              <PanelLeftOpen className="h-4.5 w-4.5" />
            </button>
          </div>
        )}

        {/* Staff Profile Card */}
        <div className="mt-3.5 mb-3">
          {!isCollapsed ? (
            <div
              onClick={onProfile}
              role="button"
              tabIndex={0}
              className="group flex cursor-pointer items-center gap-3 rounded-xl border border-sand/70 bg-white/90 p-2.5 shadow-xs transition hover:border-lotus/40 hover:bg-white"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lotus/10 font-display text-base font-semibold text-lotus ring-1 ring-lotus/20 group-hover:bg-lotus group-hover:text-white transition-colors">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-ink group-hover:text-lotus transition-colors">
                  {effectiveName}
                </p>
                <p className="truncate text-[10px] uppercase tracking-wider text-antique font-medium">
                  {effectiveEmail ?? "Staff / Vận hành"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onProfile}
                onMouseEnter={(e) => showTooltip(`${effectiveName} • Staff / Vận hành`, e)}
                onMouseLeave={hideTooltip}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-lotus/10 font-display text-base font-semibold text-lotus ring-1 ring-lotus/20 hover:bg-lotus hover:text-white transition-colors"
                aria-label="Xem hồ sơ nhân viên"
              >
                {initials}
              </button>
            </div>
          )}
        </div>

        {/* Action Button: Kiểm tra hiện vật */}
        <div className="mb-3">
          {!isCollapsed ? (
            <button
              type="button"
              onClick={handleInspectionClick}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-3.5 py-2.5 text-sm font-semibold text-white shadow-xs transition duration-200 hover:bg-oxblood hover:shadow-md active:scale-[0.99] motion-reduce:transition-none"
            >
              <ClipboardCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">Kiểm tra hiện vật</span>
            </button>
          ) : (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleInspectionClick}
                onMouseEnter={(e) => showTooltip("Kiểm tra hiện vật", e)}
                onMouseLeave={hideTooltip}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-lotus text-white shadow-xs transition duration-200 hover:bg-oxblood hover:scale-105 active:scale-95 motion-reduce:transition-none"
                aria-label="Kiểm tra hiện vật"
              >
                <ClipboardCheck className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden space-y-3.5 pr-0.5 custom-scrollbar">
          {STAFF_NAV_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = !!openGroups[group.id];
            const hasActiveChild = group.items.some((i) => i.key === active);

            if (!isCollapsed) {
              // EXPANDED MODE: Accordion
              return (
                <div key={group.id} className="border-t border-sand/50 pt-2.5 first:border-t-0 first:pt-0">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="group flex w-full items-center justify-between px-2.5 py-1.5 text-left transition-colors rounded-lg hover:bg-white/50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-1">
                      <GroupIcon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          hasActiveChild ? "text-lotus" : "text-stone-500 group-hover:text-lotus"
                        }`}
                      />
                      <span
                        className={`truncate text-[11px] font-bold uppercase tracking-[0.14em] ${
                          hasActiveChild ? "text-lotus font-extrabold" : "text-bronze/90 group-hover:text-lotus"
                        }`}
                      >
                        {group.title}
                      </span>
                    </div>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform duration-250 ease-in-out motion-reduce:transition-none ${
                        isOpen ? "rotate-180 text-lotus" : "rotate-0 group-hover:text-stone-600"
                      }`}
                    />
                  </button>

                  {/* Accordion items with smooth grid animation */}
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-250 ease-in-out motion-reduce:transition-none ${
                      isOpen
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0 pointer-events-none"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 pt-1 pl-2">
                        {group.items.map((item) => {
                          const isItemActive = item.key === active;
                          const ItemIcon = item.icon;

                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={(e) => handleItemClick(item, e)}
                              className={`group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 motion-reduce:transition-none ${
                                isItemActive
                                  ? "bg-lotus/10 font-bold text-lotus border-l-3 border-lotus shadow-2xs pl-2"
                                  : "text-stone-600 hover:bg-white hover:text-lotus"
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <ItemIcon
                                  className={`h-4 w-4 shrink-0 transition-colors ${
                                    isItemActive ? "text-lotus" : "text-stone-400 group-hover:text-lotus"
                                  }`}
                                />
                                <span className="truncate">{item.label}</span>
                              </div>
                              {item.badge === "chat" && <StaffChatNavBadge />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            } else {
              // COLLAPSED MODE: Icon button triggering flyout
              const isFlyoutOpen = flyoutGroupId === group.id;

              return (
                <div key={group.id} className="flex justify-center border-t border-sand/40 pt-2 first:border-t-0 first:pt-0">
                  <button
                    type="button"
                    onClick={(e) => handleGroupIconClick(group.id, e)}
                    onMouseEnter={(e) => showTooltip(group.title, e)}
                    onMouseLeave={hideTooltip}
                    className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 motion-reduce:transition-none ${
                      isFlyoutOpen
                        ? "bg-lotus text-white shadow-md ring-2 ring-lotus/30"
                        : hasActiveChild
                          ? "bg-lotus/15 text-lotus ring-2 ring-lotus/40 shadow-xs"
                          : "text-stone-600 hover:bg-white hover:text-lotus"
                    }`}
                    aria-label={group.title}
                    aria-expanded={isFlyoutOpen}
                  >
                    <GroupIcon className="h-5 w-5" />
                    {hasActiveChild && (
                      <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-lotus ring-2 ring-parchment" />
                    )}
                  </button>
                </div>
              );
            }
          })}
        </nav>

        {/* Footer Support Link */}
        <div className="mt-auto border-t border-sand/70 pt-3 pb-1">
          {!isCollapsed ? (
            <Link
              href="/chat"
              onClick={() => {
                if (isMobileDrawer && onCloseMobileDrawer) onCloseMobileDrawer();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white hover:text-lotus shadow-2xs"
            >
              <Headphones className="h-4.5 w-4.5 shrink-0 text-stone-500" />
              <span className="truncate">Hỗ trợ vận hành</span>
            </Link>
          ) : (
            <div className="flex justify-center">
              <Link
                href="/chat"
                onMouseEnter={(e) => showTooltip("Hỗ trợ vận hành", e)}
                onMouseLeave={hideTooltip}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-600 hover:bg-white hover:text-lotus transition shadow-2xs"
                aria-label="Hỗ trợ vận hành"
              >
                <Headphones className="h-5 w-5" />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Flyout Container */}
      {isCollapsed && activeFlyoutGroup && (
        <div
          ref={flyoutRef}
          style={{ top: `${flyoutPos.top}px`, left: `${flyoutPos.left}px` }}
          className="fixed z-50 w-56 rounded-2xl border border-sand bg-parchment p-2.5 shadow-xl transition-all duration-200 ease-out animate-in fade-in zoom-in-95 motion-reduce:transition-none"
        >
          <div className="mb-2 flex items-center justify-between border-b border-sand/70 px-2 pb-2">
            <div className="flex items-center gap-2">
              <activeFlyoutGroup.icon className="h-4 w-4 text-lotus" />
              <span className="text-xs font-bold uppercase tracking-wider text-lotus">
                {activeFlyoutGroup.title}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setFlyoutGroupId(null)}
              className="rounded-md p-1 text-stone-400 hover:bg-stone-200/50 hover:text-stone-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {activeFlyoutGroup.items.map((item) => {
              const isItemActive = item.key === active;
              const ItemIcon = item.icon;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={(e) => handleItemClick(item, e)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors duration-150 ${
                    isItemActive
                      ? "bg-lotus/15 font-bold text-lotus shadow-xs"
                      : "text-stone-700 hover:bg-white hover:text-lotus"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ItemIcon
                      className={`h-4 w-4 shrink-0 ${
                        isItemActive ? "text-lotus" : "text-stone-500"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge === "chat" && <StaffChatNavBadge />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && !flyoutGroupId && (
        <div
          style={{
            top: `${tooltip.top}px`,
            left: `${tooltip.left}px`,
            transform: "translateY(-50%)",
          }}
          className="pointer-events-none fixed z-50 rounded-lg border border-sand/30 bg-ink/90 px-2.5 py-1.5 text-[11px] font-medium text-parchment shadow-lg backdrop-blur-xs transition-opacity duration-150 animate-in fade-in zoom-in-95 motion-reduce:transition-none"
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}
