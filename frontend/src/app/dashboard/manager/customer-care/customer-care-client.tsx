"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  Eye,
  Filter,
  Headphones,
  History,
  Info,
  Mail,
  Monitor,
  Phone,
  PieChart,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Star,
  Tag,
  Ticket,
  TrendingUp,
  User,
  Users,
  XCircle,
} from "lucide-react";
import {
  fetchAttentionList,
  fetchCustomerCareAnalytics,
  fetchCustomerCareKpis,
  fetchEmailPreview,
  fetchEmailTemplatesCatalog,
  fetchManagerExtensionMonitoring,
  fetchNotificationHistory,
  fetchReminderMonitoring,
  fetchVoucherProgramStatus,
  retryNotification,
  type AttentionCategory,
  type AttentionListResult,
  type CustomerCareAnalyticsData,
  type CustomerCareAttentionItem,
  type CustomerCareKpis,
  type DailyTrendPoint,
  type EmailPreviewResult,
  type EmailTemplateCatalogItem,
  type ManagerExtensionMonitoringData,
  type NotificationDeliveryStatus,
  type NotificationHistoryItem,
  type NotificationHistoryResult,
  type ReminderMonitoringData,
  type VoucherProgramMonitoring,
} from "@/lib/customer-care-api";

type TabKey = "attention" | "reminders" | "vouchers" | "preview" | "history" | "extensions" | "analytics";

export function CustomerCareClient() {
  const [activeTab, setActiveTab] = useState<TabKey>("attention");

  // KPI State
  const [kpis, setKpis] = useState<CustomerCareKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  // Tab 1: Attention List State
  const [attentionData, setAttentionData] = useState<AttentionListResult | null>(null);
  const [attentionCategory, setAttentionCategory] = useState<AttentionCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [attentionLoading, setAttentionLoading] = useState(true);

  // Tab 2: Reminders State
  const [reminderData, setReminderData] = useState<ReminderMonitoringData | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);

  // Tab 3: Voucher Program State
  const [voucherData, setVoucherData] = useState<VoucherProgramMonitoring | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);

  // Tab 4: Email Preview State
  const [templatesCatalog, setTemplatesCatalog] = useState<EmailTemplateCatalogItem[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("booking.pickup_reminder");
  const [selectedVariant, setSelectedVariant] = useState<string>("store_pickup");
  const [previewResult, setPreviewResult] = useState<EmailPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewFormat, setPreviewFormat] = useState<"html" | "text">("html");
  const [copiedSubject, setCopiedSubject] = useState(false);

  // Tab 5: Notification History State
  const [historyData, setHistoryData] = useState<NotificationHistoryResult | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"all" | "accepted" | "failed" | "unknown">("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<NotificationHistoryItem | null>(null);
  const [historyFeedback, setHistoryFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Tab 6: Extension Monitoring State
  const [extensionData, setExtensionData] = useState<ManagerExtensionMonitoringData | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<string>("all");
  const [extensionSearch, setExtensionSearch] = useState<string>("");
  const [extensionPage, setExtensionPage] = useState<number>(1);
  const [extensionLoading, setExtensionLoading] = useState<boolean>(false);

  // Tab 7: Customer Care Analytics State
  const [analyticsData, setAnalyticsData] = useState<CustomerCareAnalyticsData | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(false);

  // 1. Tải KPI tổng quan
  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    try {
      const res = await fetchCustomerCareKpis();
      if (res.success && res.data) {
        setKpis(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải KPI Customer Care:", err);
    } finally {
      setKpisLoading(false);
    }
  }, []);

  // 2. Tải Attention List
  const loadAttentionList = useCallback(async () => {
    setAttentionLoading(true);
    try {
      const res = await fetchAttentionList({
        page,
        limit: 15,
        search: searchQuery.trim() || undefined,
        category: attentionCategory,
      });
      if (res.success && res.data) {
        setAttentionData(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải danh sách cần chăm sóc:", err);
    } finally {
      setAttentionLoading(false);
    }
  }, [page, searchQuery, attentionCategory]);

  // 3. Tải Giám sát Nhắc lịch
  const loadReminders = useCallback(async () => {
    setReminderLoading(true);
    try {
      const res = await fetchReminderMonitoring();
      if (res.success && res.data) {
        setReminderData(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải giám sát nhắc lịch:", err);
    } finally {
      setReminderLoading(false);
    }
  }, []);

  // 4. Tải Trạng thái Voucher
  const loadVouchers = useCallback(async () => {
    setVoucherLoading(true);
    try {
      const res = await fetchVoucherProgramStatus();
      if (res.success && res.data) {
        setVoucherData(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải trạng thái voucher:", err);
    } finally {
      setVoucherLoading(false);
    }
  }, []);

  // 5. Tải danh mục Templates
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetchEmailTemplatesCatalog();
      if (res.success && res.data) {
        setTemplatesCatalog(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải danh mục template:", err);
    }
  }, []);

  // 6. Tải Email Preview
  const loadEmailPreview = useCallback(async (key: string, variant?: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetchEmailPreview({ templateKey: key, variant });
      if (res.success && res.data) {
        setPreviewResult(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tạo bản xem trước email:", err);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // 7. Tải Notification History
  const loadNotificationHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetchNotificationHistory({
        page: historyPage,
        limit: 15,
        status: historyStatus,
        search: historySearch.trim() || undefined,
      });
      if (res.success && res.data) {
        setHistoryData(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải lịch sử thông báo:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historyStatus, historySearch]);

  // 8. Tải Giám sát gia hạn thuê (Tab 6)
  const loadExtensionMonitoring = useCallback(async () => {
    setExtensionLoading(true);
    try {
      const res = await fetchManagerExtensionMonitoring({
        page: extensionPage,
        limit: 15,
        status: extensionStatus,
        search: extensionSearch.trim() || undefined,
      });
      if (res.success && res.data) {
        setExtensionData(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải giám sát gia hạn:", err);
    } finally {
      setExtensionLoading(false);
    }
  }, [extensionPage, extensionStatus, extensionSearch]);

  // 9. Tải Báo cáo & Phân tích chăm sóc khách hàng (Tab 7)
  const loadAnalytics = useCallback(async (period: "7d" | "30d" | "90d") => {
    setAnalyticsLoading(true);
    try {
      const res = await fetchCustomerCareAnalytics({ period });
      if (res.success && res.data) {
        setAnalyticsData(res.data);
      }
    } catch (err) {
      console.error("Lỗi khi tải phân tích chăm sóc khách hàng:", err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const handleRetryNotification = async (item: NotificationHistoryItem) => {
    if (!item.canRetry || retryingId) return;
    const confirmed = window.confirm(
      `Bạn có chắc chắn muốn gửi lại thông báo đến ${item.recipientEmail || item.recipientName || "khách hàng"} không?`,
    );
    if (!confirmed) return;

    setRetryingId(item.id);
    setHistoryFeedback(null);
    try {
      const res = await retryNotification(item.id);
      if (res.success) {
        setHistoryFeedback({
          type: "success",
          message: `Đã gửi lại thành công (Lần thử: ${res.data?.retryCount ?? 1}).`,
        });
        await loadNotificationHistory();
      } else {
        setHistoryFeedback({
          type: "error",
          message: res.error || "Gửi lại thất bại, vui lòng kiểm tra lại log hệ thống.",
        });
      }
    } catch (err: any) {
      setHistoryFeedback({
        type: "error",
        message: err?.message || "Không thể kết nối đến máy chủ để gửi lại.",
      });
    } finally {
      setRetryingId(null);
    }
  };

  // Initial load
  useEffect(() => {
    loadKpis();
    loadTemplates();
  }, [loadKpis, loadTemplates]);

  // Trigger data theo tab
  useEffect(() => {
    if (activeTab === "attention") {
      loadAttentionList();
    } else if (activeTab === "reminders") {
      loadReminders();
    } else if (activeTab === "vouchers") {
      loadVouchers();
    } else if (activeTab === "preview") {
      loadEmailPreview(selectedTemplateKey, selectedVariant);
    } else if (activeTab === "history") {
      loadNotificationHistory();
    } else if (activeTab === "extensions") {
      loadExtensionMonitoring();
    } else if (activeTab === "analytics") {
      loadAnalytics(analyticsPeriod);
    }
  }, [
    activeTab,
    loadAttentionList,
    loadReminders,
    loadVouchers,
    loadEmailPreview,
    loadNotificationHistory,
    loadExtensionMonitoring,
    loadAnalytics,
    analyticsPeriod,
    selectedTemplateKey,
    selectedVariant,
  ]);

  // Handle template selection change
  const handleSelectTemplate = (key: string) => {
    setSelectedTemplateKey(key);
    const tmpl = templatesCatalog.find((t) => t.key === key);
    const firstVariant = tmpl?.variants?.[0] || "";
    setSelectedVariant(firstVariant);
    loadEmailPreview(key, firstVariant);
  };

  const handleCopySubject = () => {
    if (previewResult?.subject) {
      navigator.clipboard.writeText(previewResult.subject);
      setCopiedSubject(true);
      setTimeout(() => setCopiedSubject(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Real KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Đang thuê</span>
            <Tag className="w-4 h-4 text-[#881337]" />
          </div>
          <div className="text-2xl font-bold text-stone-900">
            {kpisLoading ? <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" /> : kpis?.activeRentals ?? 0}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Đơn đang phục vụ</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Nhận mai (T-1)</span>
            <Calendar className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">
            {kpisLoading ? <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" /> : kpis?.upcomingPickups ?? 0}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Nhắc lúc 09h00</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Hạn trả hôm nay</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700">
            {kpisLoading ? <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" /> : kpis?.returnsDueToday ?? 0}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Nhắc 12h &amp; 17h</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Đã hoàn tất</span>
            <CheckCircle2 className="w-4 h-4 text-stone-600" />
          </div>
          <div className="text-2xl font-bold text-stone-900">
            {kpisLoading ? <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" /> : kpis?.completedBookings ?? 0}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Tổng đơn kết thúc</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Chưa đánh giá</span>
            <Star className="w-4 h-4 text-[#D4AF37]" />
          </div>
          <div className="text-2xl font-bold text-[#881337]">
            {kpisLoading ? <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" /> : kpis?.eligibleVoucherReviews ?? 0}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">Khách cần mời review</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Đã gửi hôm nay</span>
            <Mail className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-blue-700">
            {kpisLoading ? <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" /> : kpis?.dispatchedRemindersToday ?? 0}
          </div>
          <p className="text-[11px] text-stone-500 mt-1">
            {kpis?.failedDispatchesToday ? (
              <span className="text-rose-600 font-medium">Lỗi: {kpis.failedDispatchesToday}</span>
            ) : (
              "Hoạt động ổn định"
            )}
          </p>
        </div>
      </div>

      {/* Navigation Tabs Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-stone-200 gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("attention")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "attention"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <Headphones className="w-4 h-4" />
            Đơn Cần Chăm Sóc
            {attentionData?.total ? (
              <span className="ml-1 px-2 py-0.5 text-xs bg-[#881337]/10 text-[#881337] rounded-full font-bold">
                {attentionData.total}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => setActiveTab("reminders")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "reminders"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <Clock className="w-4 h-4" />
            Giám Sát Nhắc Lịch (09h, 12h, 17h)
          </button>

          <button
            onClick={() => setActiveTab("vouchers")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "vouchers"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <Ticket className="w-4 h-4" />
            Voucher Tri Ân (Retention)
          </button>

          <button
            onClick={() => setActiveTab("preview")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "preview"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <Eye className="w-4 h-4" />
            Xem Trước Mẫu Email
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "history"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <History className="w-4 h-4" />
            Lịch Sử Thông Báo
            {historyData?.total ? (
              <span className="ml-1 px-2 py-0.5 text-xs bg-stone-100 text-stone-700 rounded-full font-bold">
                {historyData.total}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => setActiveTab("extensions")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "extensions"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <CalendarPlus className="w-4 h-4" />
            Giám Sát Gia Hạn
            {extensionData?.history?.total ? (
              <span className="ml-1 px-2 py-0.5 text-xs bg-stone-100 text-stone-700 rounded-full font-bold">
                {extensionData.history.total}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => setActiveTab("analytics")}
            className={`flex items-center gap-2 px-4 py-3 font-semibold text-sm border-b-2 transition-all ${
              activeTab === "analytics"
                ? "border-[#881337] text-[#881337]"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Phân Tích &amp; Báo Cáo
          </button>
        </div>

        <button
          onClick={() => {
            loadKpis();
            if (activeTab === "attention") loadAttentionList();
            if (activeTab === "reminders") loadReminders();
            if (activeTab === "vouchers") loadVouchers();
            if (activeTab === "preview") loadEmailPreview(selectedTemplateKey, selectedVariant);
            if (activeTab === "history") loadNotificationHistory();
            if (activeTab === "extensions") loadExtensionMonitoring();
            if (activeTab === "analytics") loadAnalytics(analyticsPeriod);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-600 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới dữ liệu
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DANH SÁCH ĐƠN CẦN CHĂM SÓC */}
      {/* ========================================================================= */}
      {activeTab === "attention" && (
        <div className="space-y-4">
          {/* Filter & Search Bar */}
          <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all", label: "Tất cả cần chú ý" },
                { key: "pickup_tomorrow", label: "Nhận mai (09h)" },
                { key: "return_today", label: "Hạn trả hôm nay" },
                { key: "pending_extension", label: "Chờ gia hạn" },
                { key: "overdue", label: "Quá hạn trả" },
                { key: "renting", label: "Đang thuê" },
              ].map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    setAttentionCategory(cat.key as AttentionCategory);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    attentionCategory === cat.key
                      ? "bg-[#881337] text-white shadow-sm"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className="relative min-w-[280px]">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm mã đơn, tên khách, số điện thoại..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
              />
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-sm overflow-hidden">
            {attentionLoading ? (
              <div className="p-12 text-center text-stone-500 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#881337]" />
                <p className="text-sm">Đang tải danh sách đơn cần chăm sóc...</p>
              </div>
            ) : attentionData?.items?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F5] border-b border-stone-200 text-stone-600 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3.5 px-4">Mã đơn &amp; Cổ phục</th>
                      <th className="py-3.5 px-4">Khách hàng</th>
                      <th className="py-3.5 px-4">Thời gian thuê</th>
                      <th className="py-3.5 px-4">Hình thức</th>
                      <th className="py-3.5 px-4">Lý do cần hỗ trợ</th>
                      <th className="py-3.5 px-4 text-right">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {attentionData.items.map((item) => {
                      let badgeColor = "bg-stone-100 text-stone-700";
                      let reasonColor = "text-stone-700";

                      if (item.attentionCategory === "pending_extension") {
                        badgeColor = "bg-amber-100 text-amber-800 border border-amber-300";
                        reasonColor = "text-amber-700 font-medium";
                      } else if (item.attentionCategory === "overdue") {
                        badgeColor = "bg-rose-100 text-rose-800 border border-rose-300";
                        reasonColor = "text-rose-700 font-medium";
                      } else if (item.attentionCategory === "return_today") {
                        badgeColor = "bg-blue-100 text-blue-800 border border-blue-300";
                        reasonColor = "text-blue-700 font-medium";
                      } else if (item.attentionCategory === "pickup_tomorrow") {
                        badgeColor = "bg-emerald-100 text-emerald-800 border border-emerald-300";
                        reasonColor = "text-emerald-700 font-medium";
                      }

                      return (
                        <tr key={item.id} className="hover:bg-stone-50/80 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-stone-900 font-mono">#{item.bookingCode}</div>
                            <div className="text-stone-600 text-[11px] truncate max-w-[220px]" title={item.garmentName}>
                              {item.garmentName}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-stone-900 flex items-center gap-1.5">
                              <User className="w-3 h-3 text-stone-400" />
                              {item.customerName}
                            </div>
                            <div className="text-stone-500 text-[11px] flex items-center gap-1.5 mt-0.5">
                              <Phone className="w-3 h-3 text-stone-400" />
                              {item.customerPhone}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="text-stone-700">
                              {item.rentalStartDate.split("-").reverse().join("/")} →{" "}
                              {item.rentalEndDate.split("-").reverse().join("/")}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-700">
                              {item.pickupMethod === "delivery" ? "Shipper tận nơi" : "Tại Showroom"}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className={reasonColor}>{item.attentionReason}</div>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${badgeColor}`}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center text-stone-500">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
                <p className="font-semibold text-stone-800">Không có đơn nào cần xử lý khẩn cấp</p>
                <p className="text-xs text-stone-500 mt-1">
                  Toàn bộ đơn hàng trong bộ lọc đã được kiểm soát tốt hoặc không có kết quả phù hợp.
                </p>
              </div>
            )}

            {/* Pagination Controls */}
            {attentionData && attentionData.totalPages > 1 && (
              <div className="p-3 border-t border-stone-200 bg-[#FAF8F5] flex items-center justify-between text-xs text-stone-600">
                <div>
                  Hiển thị {(attentionData.page - 1) * attentionData.limit + 1} -{" "}
                  {Math.min(attentionData.page * attentionData.limit, attentionData.total)} trong tổng số{" "}
                  <strong>{attentionData.total}</strong> đơn
                </div>
                <div className="flex gap-1.5">
                  <button
                    disabled={attentionData.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 bg-white border border-stone-200 rounded hover:bg-stone-50 disabled:opacity-50"
                  >
                    Trang trước
                  </button>
                  <span className="px-3 py-1 font-semibold text-stone-800">
                    Trang {attentionData.page} / {attentionData.totalPages}
                  </span>
                  <button
                    disabled={attentionData.page >= attentionData.totalPages}
                    onClick={() => setPage((p) => Math.min(attentionData.totalPages, p + 1))}
                    className="px-2.5 py-1 bg-white border border-stone-200 rounded hover:bg-stone-50 disabled:opacity-50"
                  >
                    Trang sau
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: GIÁM SÁT NHẮC LỊCH (09:00, 12:00, 17:00) */}
      {/* ========================================================================= */}
      {activeTab === "reminders" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {reminderLoading ? (
              <div className="col-span-3 p-12 text-center text-stone-500">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#881337]" />
              </div>
            ) : (
              reminderData?.milestones.map((m) => (
                <div key={m.key} className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm relative overflow-hidden">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-stone-500">
                      Mốc {m.scheduleTime}
                    </span>
                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                      {m.status === "active" ? "Tự động kích hoạt" : "Nghỉ"}
                    </span>
                  </div>

                  <h3 className="font-bold text-base text-stone-900 mb-1">{m.name}</h3>
                  <p className="text-xs text-stone-600 mb-4 min-h-[36px]">{m.targetDescription}</p>

                  <div className="space-y-2 pt-3 border-t border-stone-100 text-xs">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Lịch Cron:</span>
                      <span className="font-mono font-semibold text-stone-800">{m.cronExpression}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Số đơn đã gửi hôm nay:</span>
                      <span className="font-bold text-blue-700">{m.countToday} lượt</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Lần chạy gần nhất:</span>
                      <span className="text-stone-800 font-medium">
                        {m.lastRunAt ? new Date(m.lastRunAt).toLocaleTimeString("vi-VN") : "Chưa chạy trong ngày"}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Recent Dispatches Audit Logs */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#881337]" />
              Nhật Ký Gửi Thông Báo Tự Động Gần Nhất (Audit Trail)
            </h3>

            {reminderData?.recentDispatches?.length ? (
              <div className="divide-y divide-stone-100">
                {reminderData.recentDispatches.map((log) => (
                  <div key={log.id} className="py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      {log.status === "success" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <div>
                        <div className="font-semibold text-stone-900">
                          {log.action} {log.bookingCode ? `• Đơn #${log.bookingCode}` : ""}
                        </div>
                        <div className="text-[11px] text-stone-500">
                          {log.scheduleType ? `Khung: ${log.scheduleType} | ` : ""}
                          ID: {log.id}
                        </div>
                      </div>
                    </div>
                    <div className="text-stone-500 font-mono text-[11px]">
                      {new Date(log.dispatchedAt).toLocaleString("vi-VN")}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-500 italic">Chưa có bản ghi dispatch nào trong hệ thống.</p>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CHƯƠNG TRÌNH VOUCHER TRI ÂN (SAFETY FIRST) */}
      {/* ========================================================================= */}
      {activeTab === "vouchers" && (
        <div className="space-y-6">
          {/* Prominent Warning Banner (Safety Guard) */}
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <div className="flex items-start gap-3.5">
              <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <h4 className="font-bold text-base text-amber-950">
                  Chính Sách An Toàn Nghiệp Vụ (Safety Guard): Chương Trình Voucher Tri Ân Đang Tắt
                </h4>
                <p className="text-xs text-amber-900 leading-relaxed">
                  {voucherData?.safetyWarning ||
                    "Chương trình Voucher Tri Ân chưa được kích hoạt vì hệ thống chưa hỗ trợ giới hạn voucher theo đúng khách hàng được tặng (Customer Ownership Gap)."}
                </p>
                <div className="pt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-200/60 px-3 py-1.5 rounded-md">
                    <ShieldCheck className="h-4 w-4 text-amber-700" />
                    Trạng thái: Tạm khóa bảo vệ (Disabled)
                  </span>
                  <span className="text-xs text-amber-700 italic">
                    (Không hỗ trợ nút toggle bật để bảo vệ doanh thu &amp; tránh lạm dụng voucher)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Retention Program Policy Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                <Ticket className="w-4 h-4 text-[#881337]" />
                Đặc Tả Chính Sách Cấp Voucher Tri Ân
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Mục tiêu gắn kết:</span>
                  <span className="text-stone-800 font-medium text-right max-w-[260px]">
                    {voucherData?.retentionTargetDescription}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Điều kiện đơn hoàn tất:</span>
                  <span className="font-semibold text-stone-900">
                    Tối thiểu {voucherData?.policy.minimumCompletedBookings ?? 1} đơn hoàn tất nguyên vẹn
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Mức ưu đãi:</span>
                  <span className="font-bold text-[#881337]">
                    Giảm {voucherData?.policy.discountValue ?? 10}%
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Thời hạn sử dụng:</span>
                  <span className="text-stone-800 font-semibold">{voucherData?.policy.validityDays ?? 30} ngày</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-stone-100">
                  <span className="text-stone-500">Số lượt dùng tối đa:</span>
                  <span className="text-stone-800 font-semibold">{voucherData?.policy.maxUsage ?? 1} lượt / voucher</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-stone-500">Tiền tố mã voucher:</span>
                  <span className="font-mono font-bold text-stone-900">{voucherData?.policy.codePrefix ?? "TRIAN-"}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm space-y-4">
              <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Kiểm Soát Vận Hành &amp; Thống Kê
              </h3>
              <div className="space-y-3 text-xs">
                <div className="bg-stone-50 p-4 rounded-lg border border-stone-200 space-y-2">
                  <div className="text-stone-600">Tổng voucher tri ân đã phát hành qua AuditLog:</div>
                  <div className="text-3xl font-bold text-stone-900 font-mono">
                    {voucherLoading ? "..." : voucherData?.issuedCount ?? 0}
                  </div>
                  <p className="text-[11px] text-stone-500">
                    Bao gồm các lần phát hành thử nghiệm trong môi trường kiểm thử Phase 2D.1 và 2D.2.
                  </p>
                </div>

                <div className="p-3 bg-blue-50/70 rounded-lg border border-blue-200 text-blue-900 text-xs leading-relaxed">
                  <strong>Điều kiện để mở lại chương trình trong tương lai:</strong> Cần triển khai bảng phân quyền sở hữu
                  voucher (Voucher Assignment / Customer Scoping) ở Voucher Module để mã giảm giá chỉ có thể được áp dụng
                  bởi chính tài khoản được tặng.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: XEM TRƯỚC MẪU EMAIL (WORKSTREAM B) */}
      {/* ========================================================================= */}
      {activeTab === "preview" && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center">
            {/* Template Selector Dropdown */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs font-semibold text-stone-700">Mẫu Email:</div>
              <select
                value={selectedTemplateKey}
                onChange={(e) => handleSelectTemplate(e.target.value)}
                className="text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
              >
                {templatesCatalog.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>

              {/* Variant Selector if available */}
              {templatesCatalog.find((t) => t.key === selectedTemplateKey)?.variants?.length ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500">Biến thể:</span>
                  <select
                    value={selectedVariant}
                    onChange={(e) => {
                      setSelectedVariant(e.target.value);
                      loadEmailPreview(selectedTemplateKey, e.target.value);
                    }}
                    className="text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                  >
                    {templatesCatalog
                      .find((t) => t.key === selectedTemplateKey)
                      ?.variants?.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
            </div>

            {/* Mode & Device Controls */}
            <div className="flex items-center gap-2">
              {/* Format Toggle (HTML vs Plain Text) */}
              <div className="flex bg-stone-100 p-1 rounded-lg">
                <button
                  onClick={() => setPreviewFormat("html")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    previewFormat === "html" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  HTML Hoàng Gia
                </button>
                <button
                  onClick={() => setPreviewFormat("text")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    previewFormat === "text" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  Văn Bản Thuần
                </button>
              </div>

              {/* Device Toggle (Desktop vs Mobile) */}
              <div className="flex bg-stone-100 p-1 rounded-lg">
                <button
                  onClick={() => setPreviewDevice("desktop")}
                  className={`p-1.5 rounded-md transition-all ${
                    previewDevice === "desktop"
                      ? "bg-white text-[#881337] shadow-sm"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                  title="Desktop (600px)"
                >
                  <Monitor className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPreviewDevice("mobile")}
                  className={`p-1.5 rounded-md transition-all ${
                    previewDevice === "mobile"
                      ? "bg-white text-[#881337] shadow-sm"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                  title="Mobile (375px)"
                >
                  <Smartphone className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Subject Line & Meta Box */}
          {previewResult && (
            <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Tiêu đề Thư (Subject):</div>
                <button
                  onClick={handleCopySubject}
                  className="flex items-center gap-1 text-[11px] font-semibold text-stone-600 hover:text-[#881337]"
                >
                  {copiedSubject ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Đã sao chép
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Sao chép tiêu đề
                    </>
                  )}
                </button>
              </div>
              <div className="text-sm font-bold text-stone-900 font-mono bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-200/80">
                {previewResult.subject}
              </div>
            </div>
          )}

          {/* Email Preview Frame */}
          <div className="bg-stone-200/70 p-6 rounded-2xl flex justify-center items-center min-h-[600px] overflow-auto">
            {previewLoading ? (
              <div className="p-12 text-center text-stone-600 space-y-2">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#881337]" />
                <p className="text-xs font-semibold">Đang nạp bản xem trước email...</p>
              </div>
            ) : previewFormat === "html" && previewResult?.html ? (
              <div
                className={`transition-all duration-300 bg-white rounded-xl shadow-2xl overflow-hidden border border-stone-300 ${
                  previewDevice === "mobile" ? "w-[375px] h-[720px]" : "w-[640px] h-[820px]"
                }`}
              >
                <iframe
                  title="Email Preview Sandboxed Frame"
                  srcDoc={previewResult.html}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-none"
                />
              </div>
            ) : previewFormat === "text" && previewResult?.text ? (
              <div className="w-full max-w-2xl bg-stone-900 text-stone-100 p-6 rounded-xl font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-xl border border-stone-700">
                {previewResult.text}
              </div>
            ) : (
              <p className="text-xs text-stone-500">Chưa có dữ liệu xem trước.</p>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: LỊCH SỬ THÔNG BÁO & RETRY AN TOÀN */}
      {/* ========================================================================= */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Retry Feedback Alert */}
          {historyFeedback && (
            <div
              className={`p-4 rounded-xl flex items-start justify-between border ${
                historyFeedback.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-rose-50 border-rose-200 text-rose-900"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                {historyFeedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                )}
                <span>{historyFeedback.message}</span>
              </div>
              <button
                onClick={() => setHistoryFeedback(null)}
                className="text-xs font-semibold underline ml-4 hover:opacity-80"
              >
                Đóng
              </button>
            </div>
          )}

          {/* Stats Bar & Technical Principle Card */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-stone-200/80 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Đã tiếp nhận (Accepted)</div>
                <div className="text-xl font-bold text-emerald-700 mt-0.5">
                  {historyData?.stats.acceptedCount ?? 0}
                </div>
              </div>
              <CheckCircle2 className="w-7 h-7 text-emerald-500/30" />
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-stone-200/80 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Thất bại (Failed)</div>
                <div className="text-xl font-bold text-rose-700 mt-0.5">
                  {historyData?.stats.failedCount ?? 0}
                </div>
              </div>
              <XCircle className="w-7 h-7 text-rose-500/30" />
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-stone-200/80 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Chưa xác minh (Unknown)</div>
                <div className="text-xl font-bold text-stone-600 mt-0.5">
                  {historyData?.stats.unknownCount ?? 0}
                </div>
              </div>
              <AlertCircle className="w-7 h-7 text-stone-400/30" />
            </div>

            <div className="bg-amber-50/60 p-3.5 rounded-xl border border-amber-200/80 text-amber-900 flex items-start gap-2.5 text-xs">
              <Info className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="leading-snug">
                <span className="font-bold">Bảo vệ tính trung thực:</span> Hệ thống chỉ hiển thị trạng thái đã được xác minh kỹ thuật. Tuyệt đối không suy diễn &quot;delivered&quot; nếu chưa có webhook từ provider.
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              {/* Search Box */}
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => {
                    setHistorySearch(e.target.value);
                    setHistoryPage(1);
                  }}
                  placeholder="Tìm theo mã đơn, email, người nhận..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#881337] focus:border-[#881337] bg-[#FAF8F5]/50"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
                {(
                  [
                    { key: "all", label: "Tất cả trạng thái" },
                    { key: "accepted", label: "Đã tiếp nhận" },
                    { key: "failed", label: "Thất bại" },
                    { key: "unknown", label: "Chưa xác minh" },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.key}
                    onClick={() => {
                      setHistoryStatus(st.key);
                      setHistoryPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      historyStatus === st.key
                        ? "bg-[#881337] text-white shadow-sm"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200/80"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* History Data Table */}
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-stone-600">
                <thead className="bg-[#FAF8F5] border-b border-stone-200 text-stone-700 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Thời Gian</th>
                    <th className="py-3 px-4">Đơn Hàng</th>
                    <th className="py-3 px-4">Người Nhận</th>
                    <th className="py-3 px-4">Loại Thông Báo</th>
                    <th className="py-3 px-4">Kênh &amp; Cổng</th>
                    <th className="py-3 px-4">Trạng Thái</th>
                    <th className="py-3 px-4">Chi Tiết Lỗi / Ghi Chú</th>
                    <th className="py-3 px-4 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 font-medium">
                  {historyLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-stone-400">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#881337]" />
                        Đang nạp lịch sử thông báo...
                      </td>
                    </tr>
                  ) : !historyData?.items || historyData.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-stone-400">
                        Không tìm thấy bản ghi thông báo nào phù hợp điều kiện lọc.
                      </td>
                    </tr>
                  ) : (
                    historyData.items.map((item) => (
                      <tr key={item.id} className="hover:bg-stone-50/60 transition-colors">
                        {/* Thời gian */}
                        <td className="py-3.5 px-4 font-mono text-[11px] text-stone-500 whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleString("vi-VN", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </td>

                        {/* Đơn hàng */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {item.bookingCode ? (
                            <span className="font-mono font-bold text-[#881337] bg-[#881337]/5 px-2 py-0.5 rounded border border-[#881337]/10">
                              #{item.bookingCode}
                            </span>
                          ) : (
                            <span className="text-stone-400 italic">Hệ thống</span>
                          )}
                        </td>

                        {/* Người nhận */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-stone-900">{item.recipientName || "Khách hàng"}</div>
                          <div className="text-[11px] text-stone-500 font-mono truncate max-w-[180px]">
                            {item.recipientEmail || item.recipientPhone || "N/A"}
                          </div>
                        </td>

                        {/* Loại thông báo */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                            {item.notificationType === "pickup_reminder"
                              ? "Nhắc nhận đồ"
                              : item.notificationType === "return_reminder"
                              ? "Nhắc trả đồ"
                              : item.notificationType === "thank_you_voucher"
                              ? "Voucher tri ân"
                              : item.notificationType === "review_invite"
                              ? "Mời đánh giá"
                              : item.notificationType || item.action}
                          </span>
                        </td>

                        {/* Kênh & Cổng */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {item.channels.includes("email") && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/60">
                                <Mail className="w-3 h-3" /> Email
                              </span>
                            )}
                            {item.channels.includes("inApp") && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60">
                                In-App
                              </span>
                            )}
                          </div>
                          {item.provider && (
                            <div className="text-[10px] text-stone-400 font-mono mt-0.5 uppercase">
                              Cổng: {item.provider}
                            </div>
                          )}
                        </td>

                        {/* Trạng thái kỹ thuật */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {item.status === "accepted" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Đã tiếp nhận
                            </span>
                          ) : item.status === "failed" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                              <XCircle className="w-3 h-3 text-rose-600" /> Thất bại
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-stone-600 bg-stone-100 px-2 py-0.5 rounded-full border border-stone-200">
                              <AlertCircle className="w-3 h-3 text-stone-500" /> Chưa xác minh
                            </span>
                          )}
                        </td>

                        {/* Chi tiết lỗi */}
                        <td className="py-3.5 px-4 max-w-xs">
                          {item.error ? (
                            <div className="text-[11px] text-rose-700 font-mono line-clamp-2 bg-rose-50/50 p-1.5 rounded border border-rose-200/60">
                              {item.error}
                            </div>
                          ) : (
                            <span className="text-stone-400 text-[11px]">—</span>
                          )}
                        </td>

                        {/* Thao tác */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                          <button
                            onClick={() => setSelectedHistoryItem(item)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded transition-all"
                          >
                            Chi tiết
                          </button>

                          {item.canRetry && (
                            <button
                              disabled={retryingId === item.id}
                              onClick={() => handleRetryNotification(item)}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#881337] hover:bg-[#6e0f2b] disabled:bg-stone-300 rounded shadow-sm inline-flex items-center gap-1 transition-all"
                            >
                              {retryingId === item.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                              Gửi lại
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {historyData && historyData.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-[#FAF8F5] text-xs">
                <div className="text-stone-500">
                  Hiển thị trang <span className="font-bold text-stone-900">{historyData.page}</span> / {historyData.totalPages} ({historyData.total} thông báo)
                </div>
                <div className="flex gap-1.5">
                  <button
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 bg-white border border-stone-200 rounded text-stone-700 disabled:opacity-50 font-semibold"
                  >
                    Trước
                  </button>
                  <button
                    disabled={historyPage >= historyData.totalPages}
                    onClick={() => setHistoryPage((p) => p + 1)}
                    className="px-3 py-1 bg-white border border-stone-200 rounded text-stone-700 disabled:opacity-50 font-semibold"
                  >
                    Sau
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Notification Details Modal */}
          {selectedHistoryItem && (
            <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl border border-stone-200 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-[#881337]" />
                    <h3 className="font-bold text-stone-900 text-sm">Chi Tiết Nhật Ký Thông Báo</h3>
                  </div>
                  <button
                    onClick={() => setSelectedHistoryItem(null)}
                    className="text-stone-400 hover:text-stone-600 font-bold text-lg"
                  >
                    &times;
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2 bg-[#FAF8F5] p-3 rounded-xl border border-stone-200">
                    <div>
                      <span className="text-stone-500 font-medium">Mã nhật ký (Log ID):</span>
                      <div className="font-mono font-bold text-stone-900">{selectedHistoryItem.id}</div>
                    </div>
                    <div>
                      <span className="text-stone-500 font-medium">Hành động hệ thống:</span>
                      <div className="font-mono font-bold text-stone-900">{selectedHistoryItem.action}</div>
                    </div>
                    <div>
                      <span className="text-stone-500 font-medium">Trạng thái kỹ thuật:</span>
                      <div className="font-bold text-stone-900 uppercase">{selectedHistoryItem.status}</div>
                    </div>
                    <div>
                      <span className="text-stone-500 font-medium">Thời gian ghi nhận:</span>
                      <div className="font-mono text-stone-800">
                        {new Date(selectedHistoryItem.createdAt).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </div>
                    </div>
                    <div>
                      <span className="text-stone-500 font-medium">Mã đơn liên kết:</span>
                      <div className="font-mono font-bold text-[#881337]">
                        {selectedHistoryItem.bookingCode ? `#${selectedHistoryItem.bookingCode}` : "Không có"}
                      </div>
                    </div>
                    <div>
                      <span className="text-stone-500 font-medium">Số lần đã retry:</span>
                      <div className="font-bold text-stone-900">{selectedHistoryItem.retryCount} / 3</div>
                    </div>
                  </div>

                  <div>
                    <span className="text-stone-500 font-medium">Người nhận thông báo:</span>
                    <div className="font-bold text-stone-900">
                      {selectedHistoryItem.recipientName} ({selectedHistoryItem.recipientEmail || "N/A"})
                    </div>
                  </div>

                  {selectedHistoryItem.error && (
                    <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-rose-900">
                      <div className="font-bold mb-1 flex items-center gap-1.5 text-xs text-rose-800">
                        <AlertTriangle className="w-3.5 h-3.5" /> Chi tiết lỗi kỹ thuật (Đã làm sạch):
                      </div>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap">{selectedHistoryItem.error}</pre>
                    </div>
                  )}

                  {selectedHistoryItem.metadata && (
                    <div>
                      <span className="text-stone-500 font-medium">Metadata lưu trữ:</span>
                      <pre className="bg-stone-900 text-stone-100 p-3 rounded-xl font-mono text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {JSON.stringify(selectedHistoryItem.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
                  <button
                    onClick={() => setSelectedHistoryItem(null)}
                    className="px-4 py-2 text-xs font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg"
                  >
                    Đóng
                  </button>
                  {selectedHistoryItem.canRetry && (
                    <button
                      disabled={retryingId === selectedHistoryItem.id}
                      onClick={async () => {
                        const item = selectedHistoryItem;
                        setSelectedHistoryItem(null);
                        await handleRetryNotification(item);
                      }}
                      className="px-4 py-2 text-xs font-bold text-white bg-[#881337] hover:bg-[#6e0f2b] rounded-lg shadow-sm flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" /> Thử lại ngay
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: GIÁM SÁT GIA HẠN THUÊ (EXTENSION MONITORING) */}
      {/* ========================================================================= */}
      {activeTab === "extensions" && (
        <div className="space-y-6">
          {/* Top KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
            <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Tổng yêu cầu</span>
                <CalendarPlus className="w-4 h-4 text-stone-600" />
              </div>
              <div className="text-2xl font-bold text-stone-900">
                {extensionLoading ? (
                  <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" />
                ) : (
                  extensionData?.kpis.totalRequests ?? 0
                )}
              </div>
              <p className="text-[11px] text-stone-500 mt-1">Yêu cầu gia hạn</p>
            </div>

            <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Đã áp dụng</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-emerald-700">
                {extensionLoading ? (
                  <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" />
                ) : (
                  extensionData?.kpis.appliedCount ?? 0
                )}
              </div>
              <p className="text-[11px] text-emerald-600 font-medium mt-1">Gia hạn thành công</p>
            </div>

            <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Chờ thanh toán</span>
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-amber-700">
                {extensionLoading ? (
                  <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" />
                ) : (
                  extensionData?.kpis.pendingCount ?? 0
                )}
              </div>
              <p className="text-[11px] text-amber-600 font-medium mt-1">Giữ chỗ 15 phút</p>
            </div>

            <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Hết hạn / Hủy</span>
                <XCircle className="w-4 h-4 text-stone-500" />
              </div>
              <div className="text-2xl font-bold text-stone-700">
                {extensionLoading ? (
                  <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" />
                ) : (
                  (extensionData?.kpis.expiredCount ?? 0) + (extensionData?.kpis.failedCount ?? 0)
                )}
              </div>
              <p className="text-[11px] text-stone-500 mt-1">Không hoàn tất</p>
            </div>

            <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Tỷ lệ thành công</span>
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-blue-700">
                {extensionLoading ? (
                  <span className="inline-block w-8 h-6 bg-stone-100 animate-pulse rounded" />
                ) : (
                  `${extensionData?.kpis.successRate ?? 0}%`
                )}
              </div>
              <p className="text-[11px] text-stone-500 mt-1">Áp dụng / Tổng yêu cầu</p>
            </div>

            <div className="bg-white rounded-xl border border-stone-200/80 p-4 shadow-sm hover:border-[#D4AF37]/50 transition-all">
              <div className="flex items-center justify-between text-stone-500 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider">Doanh thu gia hạn</span>
                <DollarSign className="w-4 h-4 text-[#881337]" />
              </div>
              <div className="text-xl font-bold text-[#881337] truncate" title={`${extensionData?.kpis.totalPaidRevenue ?? 0} đ`}>
                {extensionLoading ? (
                  <span className="inline-block w-16 h-6 bg-stone-100 animate-pulse rounded" />
                ) : (
                  `${(extensionData?.kpis.totalPaidRevenue ?? 0).toLocaleString("vi-VN")} ₫`
                )}
              </div>
              <p className="text-[11px] text-stone-500 mt-1">Doanh thu thực tế đã thu</p>
            </div>
          </div>

          {/* Filter Bar & Search */}
          <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
            {/* Status Tabs */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all", label: "Tất cả" },
                { key: "pending", label: "Chờ thanh toán" },
                { key: "applied", label: "Đã áp dụng" },
                { key: "expired", label: "Hết hạn" },
                { key: "cancelled", label: "Đã hủy" },
                { key: "failed", label: "Thất bại" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setExtensionStatus(tab.key);
                    setExtensionPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    extensionStatus === tab.key
                      ? "bg-[#881337] text-white shadow-sm"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className="relative min-w-[280px]">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm mã đơn, tên khách hàng, email..."
                value={extensionSearch}
                onChange={(e) => {
                  setExtensionSearch(e.target.value);
                  setExtensionPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
              />
            </div>
          </div>

          {/* Extensions History Table */}
          <div className="bg-white rounded-xl border border-stone-200/80 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF8F5] border-b border-stone-200 text-stone-600 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3.5 px-4 whitespace-nowrap">Thời gian</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Mã đơn &amp; Cổ phục</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Khách hàng</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Hạn thuê cũ → mới</th>
                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Số ngày thêm</th>
                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Phí gia hạn</th>
                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Trạng thái</th>
                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Thanh toán</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {extensionLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-stone-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#881337] mb-2" />
                        Đang tải danh sách gia hạn thuê...
                      </td>
                    </tr>
                  ) : !extensionData?.history.items || extensionData.history.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-stone-400">
                        Chưa có yêu cầu gia hạn nào phù hợp điều kiện lọc.
                      </td>
                    </tr>
                  ) : (
                    extensionData.history.items.map((item) => (
                      <tr key={item.id} className="hover:bg-stone-50/70 transition-colors">
                        {/* Thời gian */}
                        <td className="py-3.5 px-4 font-mono text-[11px] text-stone-500 whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleString("vi-VN", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </td>

                        {/* Đơn hàng & Cổ phục */}
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-[#881337]">#{item.bookingCode}</div>
                          <div className="text-stone-600 text-[11px] truncate max-w-[200px]" title={item.garmentName}>
                            {item.garmentName}
                          </div>
                        </td>

                        {/* Khách hàng */}
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-stone-900">{item.customerName || "Khách hàng"}</div>
                          <div className="text-[11px] text-stone-500 font-mono truncate max-w-[180px]">
                            {item.customerEmail || item.customerPhone || "N/A"}
                          </div>
                        </td>

                        {/* Hạn cũ -> Hạn mới */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <span className="text-stone-500">
                              {new Date(item.previousEndDate).toLocaleDateString("vi-VN", {
                                timeZone: "Asia/Ho_Chi_Minh",
                                day: "2-digit",
                                month: "2-digit",
                              })}
                            </span>
                            <ArrowRight className="w-3 h-3 text-stone-400" />
                            <span className="font-bold text-[#881337]">
                              {new Date(item.newEndDate).toLocaleDateString("vi-VN", {
                                timeZone: "Asia/Ho_Chi_Minh",
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        </td>

                        {/* Số ngày */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            +{item.extraDays} ngày
                          </span>
                        </td>

                        {/* Phí */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-stone-900 whitespace-nowrap">
                          {item.amount.toLocaleString("vi-VN")} ₫
                        </td>

                        {/* Trạng thái */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {item.status === "applied" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Đã áp dụng
                            </span>
                          ) : item.status === "pending" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              <Clock className="w-3 h-3 text-amber-600" /> Chờ thanh toán
                            </span>
                          ) : item.status === "expired" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-600 bg-stone-100 px-2 py-0.5 rounded-full border border-stone-200">
                              Hết hạn
                            </span>
                          ) : item.status === "cancelled" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                              Đã hủy
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                              Thất bại
                            </span>
                          )}
                        </td>

                        {/* Thanh toán */}
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          {item.paymentStatus === "paid" ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Đã trả phí
                            </span>
                          ) : item.paymentStatus === "pending" ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Chờ nộp phí
                            </span>
                          ) : item.paymentStatus === "failed" ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              Lỗi thanh toán
                            </span>
                          ) : (
                            <span className="text-stone-400 font-mono text-[11px]">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {extensionData?.history && extensionData.history.totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-stone-200 bg-[#FAF8F5]">
                <div className="text-xs text-stone-500">
                  Hiển thị <span className="font-semibold text-stone-900">{extensionData.history.items.length}</span> /{" "}
                  <span className="font-semibold text-stone-900">{extensionData.history.total}</span> yêu cầu gia hạn
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={extensionPage <= 1 || extensionLoading}
                    onClick={() => setExtensionPage((prev) => Math.max(1, prev - 1))}
                    className="p-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4 text-stone-600" />
                  </button>

                  <span className="text-xs font-semibold px-2 text-stone-700">
                    Trang {extensionPage} / {extensionData.history.totalPages}
                  </span>

                  <button
                    disabled={extensionPage >= extensionData.history.totalPages || extensionLoading}
                    onClick={() => setExtensionPage((prev) => Math.min(extensionData.history.totalPages, prev + 1))}
                    className="p-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4 text-stone-600" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 7: PHÂN TÍCH & BÁO CÁO CHĂM SÓC KHÁCH HÀNG (ANALYTICS & CHARTS) */}
      {/* ========================================================================= */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          {/* Filter Bar: Period Selection & Timezone Badge */}
          <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-stone-700 uppercase tracking-wider">Khoảng thời gian:</span>
              <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-lg">
                {[
                  { key: "7d", label: "7 ngày qua" },
                  { key: "30d", label: "30 ngày qua" },
                  { key: "90d", label: "90 ngày qua" },
                ].map((period) => (
                  <button
                    key={period.key}
                    onClick={() => {
                      setAnalyticsPeriod(period.key as "7d" | "30d" | "90d");
                      loadAnalytics(period.key as "7d" | "30d" | "90d");
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                      analyticsPeriod === period.key
                        ? "bg-[#881337] text-white shadow-sm"
                        : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 font-mono">
              <span className="bg-stone-100 px-2.5 py-1 rounded-md text-stone-700 border border-stone-200">
                Múi giờ: Asia/Ho_Chi_Minh (GMT+7)
              </span>
              {analyticsData && (
                <span className="bg-[#FAF8F5] px-2.5 py-1 rounded-md text-stone-600 border border-stone-200">
                  {analyticsData.fromDate} → {analyticsData.toDate}
                </span>
              )}
            </div>
          </div>

          {/* Section 1: KPI Analytics Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* 1. Đơn hàng & Vận hành */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#881337]/10 flex items-center justify-center text-[#881337]">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-sm">Đơn Hàng &amp; Vận Hành</h3>
                    <p className="text-[11px] text-stone-500">Quy mô phục vụ trong kỳ</p>
                  </div>
                </div>
                <span className="text-xl font-bold text-stone-900 font-mono">
                  {analyticsLoading ? "..." : analyticsData?.bookingAnalytics.totalBookings ?? 0}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Đang thuê:</span>
                  <span className="font-bold text-stone-900 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.bookingAnalytics.rentingBookings ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Đã hoàn tất:</span>
                  <span className="font-bold text-emerald-700 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.bookingAnalytics.completedBookings ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Sắp nhận (T-1):</span>
                  <span className="font-bold text-stone-700 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.bookingAnalytics.upcomingPickups ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Quá hạn trả:</span>
                  <span className="font-bold text-rose-700 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.bookingAnalytics.overdueBookings ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Tự động hóa nhắc lịch */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-sm">Tự Động Hóa Nhắc Lịch</h3>
                    <p className="text-[11px] text-stone-500">Tiến trình cron 09h, 12h, 17h</p>
                  </div>
                </div>
                <span className="text-xl font-bold text-emerald-700 font-mono">
                  {analyticsLoading ? "..." : analyticsData?.reminderAnalytics.totalDispatches ?? 0}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Nhận mai (09h00):</span>
                  <span className="font-bold text-emerald-800 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.reminderAnalytics.pickup09hDispatches ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Hạn trả (12h00):</span>
                  <span className="font-bold text-amber-800 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.reminderAnalytics.return12hDispatches ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Cận hạn (17h00):</span>
                  <span className="font-bold text-blue-800 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.reminderAnalytics.return17hDispatches ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Lỗi dispatch:</span>
                  <span className="font-bold text-rose-700 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.reminderAnalytics.failedDispatches ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Độ tin cậy chuyển giao Email */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-700">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-sm">Độ Tin Cậy Email</h3>
                    <p className="text-[11px] text-stone-500">Chấp thuận từ Resend/SMTP</p>
                  </div>
                </div>
                <span className="text-xl font-bold text-blue-700 font-mono">
                  {analyticsLoading ? "..." : analyticsData?.emailAnalytics.acceptedCount ?? 0}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100 text-center">
                  <span className="text-stone-500 text-[11px] block">Đã tiếp nhận</span>
                  <span className="font-bold text-emerald-700 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.emailAnalytics.acceptedCount ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100 text-center">
                  <span className="text-stone-500 text-[11px] block">Thất bại</span>
                  <span className="font-bold text-rose-700 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.emailAnalytics.failedCount ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100 text-center">
                  <span className="text-stone-500 text-[11px] block">Chưa rõ</span>
                  <span className="font-bold text-stone-600 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.emailAnalytics.unknownCount ?? 0}
                  </span>
                </div>
              </div>

              <div className="p-2 bg-stone-50 rounded-lg border border-stone-200/70 text-[11px] text-stone-600 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
                <span>Trạng thái kỹ thuật tiếp nhận từ cổng email. Tuyệt đối không giả lập &quot;delivered&quot; khi chưa tích hợp webhook xác thực.</span>
              </div>
            </div>

            {/* 4. Hiệu quả gia hạn thuê */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-700">
                    <CalendarPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-sm">Hiệu Quả Gia Hạn</h3>
                    <p className="text-[11px] text-stone-500">Tỷ lệ thành công &amp; doanh thu</p>
                  </div>
                </div>
                <span className="text-xl font-bold text-amber-700 font-mono">
                  {analyticsLoading ? "..." : `${analyticsData?.extensionAnalytics.successRate ?? 0}%`}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-stone-100">
                  <span className="text-stone-600">Tổng yêu cầu gia hạn:</span>
                  <span className="font-bold text-stone-900 font-mono">
                    {analyticsData?.extensionAnalytics.totalRequests ?? 0}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-stone-100">
                  <span className="text-stone-600">Đã áp dụng thành công:</span>
                  <span className="font-bold text-emerald-700 font-mono">
                    {analyticsData?.extensionAnalytics.appliedCount ?? 0}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-stone-600">Doanh thu phát sinh thêm:</span>
                  <span className="font-bold text-[#881337] font-mono">
                    {(analyticsData?.extensionAnalytics.totalPaidRevenue ?? 0).toLocaleString("vi-VN")} ₫
                  </span>
                </div>
              </div>
            </div>

            {/* 5. Giữ chân khách hàng (Retention) */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-700">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-sm">Giữ Chân Khách Hàng</h3>
                    <p className="text-[11px] text-stone-500">Tỷ lệ khách quay lại thuê</p>
                  </div>
                </div>
                <span className="text-xl font-bold text-purple-700 font-mono">
                  {analyticsLoading ? "..." : `${analyticsData?.retentionAnalytics.retentionRate ?? 0}%`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Khách mới (1 lần):</span>
                  <span className="font-bold text-stone-800 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.retentionAnalytics.firstTimeRenters ?? 0}
                  </span>
                </div>
                <div className="bg-[#FAF8F5] p-2.5 rounded-lg border border-stone-100">
                  <span className="text-stone-500 text-[11px] block">Khách quay lại (≥2):</span>
                  <span className="font-bold text-purple-800 text-sm">
                    {analyticsLoading ? "..." : analyticsData?.retentionAnalytics.returningRenters ?? 0}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between text-stone-500">
                  <span>Phân tầng: 1 lần ({analyticsData?.retentionAnalytics.tierDistribution.singleBooking ?? 0})</span>
                  <span>2-3 lần ({analyticsData?.retentionAnalytics.tierDistribution.twoToThreeBookings ?? 0})</span>
                  <span>4+ lần ({analyticsData?.retentionAnalytics.tierDistribution.fourPlusBookings ?? 0})</span>
                </div>
              </div>
            </div>

            {/* 6. Trạng thái Voucher Tri Ân */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-[#881337]">
                    <Ticket className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900 text-sm">Voucher Tri Ân</h3>
                    <p className="text-[11px] text-stone-500">Chính sách ưu đãi khách hàng</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-[#881337] border border-rose-300">
                  {analyticsData?.voucherAnalytics.programStatus ?? "DISABLED"}
                </span>
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 text-xs">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  Bảo vệ an toàn quỹ Voucher
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  {analyticsData?.voucherAnalytics.safetyWarning ||
                    "Tạm ngừng tự động phát hành để bảo vệ quỹ do thiếu cơ chế xác thực quyền sở hữu tài khoản khách hàng. Chỉ kích hoạt khi có Customer Ownership Enforcement."}
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Visual Responsive Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Xu hướng khối lượng đơn hàng theo ngày */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4 lg:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3">
                <div>
                  <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[#881337]" />
                    Xu Hướng Khối Lượng Đơn Hàng Theo Ngày (Daily Booking Volume Trend)
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    Số lượng đơn đặt mới và đơn hoàn tất theo từng ngày trong kỳ chọn (không gián đoạn ngày)
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-[#881337]" />
                    <span className="text-stone-600 font-medium">Đơn tạo mới</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-emerald-600" />
                    <span className="text-stone-600 font-medium">Đơn hoàn tất</span>
                  </div>
                </div>
              </div>

              {/* Pure SVG Bar Chart */}
              {analyticsLoading ? (
                <div className="h-64 flex items-center justify-center text-stone-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#881337]" />
                </div>
              ) : !analyticsData?.charts.bookingTrend || analyticsData.charts.bookingTrend.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-stone-400 text-xs">
                  Chưa có dữ liệu xu hướng đơn hàng trong khoảng thời gian này.
                </div>
              ) : (
                <div className="w-full overflow-x-auto pt-2">
                  <div className="min-w-[640px]">
                    {(() => {
                      const trend = analyticsData.charts.bookingTrend;
                      const maxVal = Math.max(1, ...trend.map((p) => Math.max(p.bookingsCount, p.completedCount)));
                      const width = 800;
                      const height = 220;
                      const padLeft = 35;
                      const padRight = 20;
                      const padTop = 15;
                      const padBottom = 35;
                      const plotWidth = width - padLeft - padRight;
                      const plotHeight = height - padTop - padBottom;
                      const step = trend.length > 1 ? plotWidth / (trend.length - 1) : plotWidth;
                      const barW = Math.max(3, Math.min(12, (plotWidth / trend.length) * 0.35));

                      return (
                        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 select-none">
                          {/* Grid lines */}
                          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const y = padTop + plotHeight - ratio * plotHeight;
                            const val = Math.round(ratio * maxVal);
                            return (
                              <g key={ratio}>
                                <line
                                  x1={padLeft}
                                  y1={y}
                                  x2={width - padRight}
                                  y2={y}
                                  stroke="#E7E5E4"
                                  strokeDasharray="3 3"
                                />
                                <text
                                  x={padLeft - 6}
                                  y={y + 3}
                                  textAnchor="end"
                                  className="text-[9px] fill-stone-400 font-mono"
                                >
                                  {val}
                                </text>
                              </g>
                            );
                          })}

                          {/* Bars for each day */}
                          {trend.map((point, idx) => {
                            const cx = padLeft + idx * step;
                            const h1 = (point.bookingsCount / maxVal) * plotHeight;
                            const h2 = (point.completedCount / maxVal) * plotHeight;
                            const y1 = padTop + plotHeight - h1;
                            const y2 = padTop + plotHeight - h2;
                            const showLabel =
                              trend.length <= 14 ||
                              idx % Math.ceil(trend.length / 10) === 0 ||
                              idx === trend.length - 1;

                            return (
                              <g key={point.date}>
                                <title>
                                  {`${point.date}: ${point.bookingsCount} đơn đặt mới, ${point.completedCount} đơn hoàn tất`}
                                </title>
                                {/* Booking Bar */}
                                {point.bookingsCount > 0 && (
                                  <rect
                                    x={cx - barW - 1}
                                    y={y1}
                                    width={barW}
                                    height={Math.max(2, h1)}
                                    rx={2}
                                    fill="#881337"
                                    className="transition-all hover:opacity-80"
                                  />
                                )}
                                {/* Completed Bar */}
                                {point.completedCount > 0 && (
                                  <rect
                                    x={cx + 1}
                                    y={y2}
                                    width={barW}
                                    height={Math.max(2, h2)}
                                    rx={2}
                                    fill="#059669"
                                    className="transition-all hover:opacity-80"
                                  />
                                )}
                                {/* X-Axis Date label */}
                                {showLabel && (
                                  <text
                                    x={cx}
                                    y={height - 10}
                                    textAnchor="middle"
                                    className="text-[9px] fill-stone-500 font-mono"
                                  >
                                    {point.date.slice(5)}
                                  </text>
                                )}
                              </g>
                            );
                          })}

                          {/* Bottom baseline */}
                          <line
                            x1={padLeft}
                            y1={padTop + plotHeight}
                            x2={width - padRight}
                            y2={padTop + plotHeight}
                            stroke="#A8A29E"
                          />
                        </svg>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Chart 2: Cơ cấu nhắc lịch chăm sóc */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-700" />
                  Cơ Cấu Nhắc Lịch Tự Động (09h, 12h, 17h)
                </h3>
                <p className="text-[11px] text-stone-500">Phân bổ thông báo nhắc lịch theo mốc thời gian</p>
              </div>

              {(() => {
                const breakdown = analyticsData?.charts.reminderBreakdown || [];
                const total = breakdown.reduce((sum, item) => sum + item.count, 0);

                return (
                  <div className="space-y-4">
                    {/* Multi-segment Bar */}
                    <div className="h-6 w-full rounded-lg bg-stone-100 flex overflow-hidden">
                      {total === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">
                          Chưa có lượt gửi trong kỳ
                        </div>
                      ) : (
                        breakdown.map((item) => {
                          const pct = total > 0 ? (item.count / total) * 100 : 0;
                          if (pct === 0) return null;
                          return (
                            <div
                              key={item.name}
                              style={{ width: `${pct}%`, backgroundColor: item.color }}
                              title={`${item.name}: ${item.count} (${pct.toFixed(1)}%)`}
                              className="h-full transition-all hover:opacity-90"
                            />
                          );
                        })
                      )}
                    </div>

                    {/* Breakdown List */}
                    <div className="space-y-2">
                      {breakdown.map((item) => {
                        const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0.0";
                        return (
                          <div key={item.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="text-stone-700 font-medium">{item.name}</span>
                            </div>
                            <div className="font-mono text-stone-900 font-semibold">
                              {item.count}{" "}
                              <span className="text-[11px] text-stone-400 font-normal">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Chart 3: Trạng thái tiếp nhận Email */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-700" />
                  Trạng Thái Chuyển Giao Email (Delivery Status)
                </h3>
                <p className="text-[11px] text-stone-500">Tỷ lệ tiếp nhận kỹ thuật từ hệ thống gửi thư</p>
              </div>

              {(() => {
                const breakdown = analyticsData?.charts.emailStatusBreakdown || [];
                const total = breakdown.reduce((sum, item) => sum + item.count, 0);

                return (
                  <div className="space-y-4">
                    {/* Multi-segment Bar */}
                    <div className="h-6 w-full rounded-lg bg-stone-100 flex overflow-hidden">
                      {total === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">
                          Chưa có email nào trong kỳ
                        </div>
                      ) : (
                        breakdown.map((item) => {
                          const pct = total > 0 ? (item.count / total) * 100 : 0;
                          if (pct === 0) return null;
                          return (
                            <div
                              key={item.name}
                              style={{ width: `${pct}%`, backgroundColor: item.color }}
                              title={`${item.name}: ${item.count} (${pct.toFixed(1)}%)`}
                              className="h-full transition-all hover:opacity-90"
                            />
                          );
                        })
                      )}
                    </div>

                    {/* Breakdown List */}
                    <div className="space-y-2">
                      {breakdown.map((item) => {
                        const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0.0";
                        return (
                          <div key={item.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="text-stone-700 font-medium">{item.name}</span>
                            </div>
                            <div className="font-mono text-stone-900 font-semibold">
                              {item.count}{" "}
                              <span className="text-[11px] text-stone-400 font-normal">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Chart 4: Kết quả gia hạn thuê */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
                  <CalendarPlus className="w-4 h-4 text-amber-700" />
                  Kết Quả Gia Hạn Thuê (Extension Outcomes)
                </h3>
                <p className="text-[11px] text-stone-500">Phân bổ kết quả các yêu cầu gia hạn thuê cổ phục</p>
              </div>

              {(() => {
                const breakdown = analyticsData?.charts.extensionBreakdown || [];
                const total = breakdown.reduce((sum, item) => sum + item.count, 0);

                return (
                  <div className="space-y-4">
                    {/* Multi-segment Bar */}
                    <div className="h-6 w-full rounded-lg bg-stone-100 flex overflow-hidden">
                      {total === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">
                          Chưa có yêu cầu gia hạn nào trong kỳ
                        </div>
                      ) : (
                        breakdown.map((item) => {
                          const pct = total > 0 ? (item.count / total) * 100 : 0;
                          if (pct === 0) return null;
                          return (
                            <div
                              key={item.name}
                              style={{ width: `${pct}%`, backgroundColor: item.color }}
                              title={`${item.name}: ${item.count} (${pct.toFixed(1)}%)`}
                              className="h-full transition-all hover:opacity-90"
                            />
                          );
                        })
                      )}
                    </div>

                    {/* Breakdown List */}
                    <div className="space-y-2">
                      {breakdown.map((item) => {
                        const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0.0";
                        return (
                          <div key={item.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="text-stone-700 font-medium">{item.name}</span>
                            </div>
                            <div className="font-mono text-stone-900 font-semibold">
                              {item.count}{" "}
                              <span className="text-[11px] text-stone-400 font-normal">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Chart 5: Phân khúc giữ chân khách hàng */}
            <div className="bg-white rounded-xl border border-stone-200/80 p-5 shadow-sm space-y-4">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-700" />
                  Phân Khúc Khách Hàng (Retention &amp; Loyalty)
                </h3>
                <p className="text-[11px] text-stone-500">Tỷ lệ khách thuê lần đầu vs khách hàng quay lại</p>
              </div>

              {(() => {
                const segmentation = analyticsData?.charts.customerSegmentation || [];
                const totalRenters = analyticsData?.retentionAnalytics.totalActiveCustomers ?? 0;
                const tiers = analyticsData?.retentionAnalytics.tierDistribution;

                return (
                  <div className="space-y-4">
                    {/* Visual Segment Bar */}
                    <div className="h-6 w-full rounded-lg bg-stone-100 flex overflow-hidden">
                      {totalRenters === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">
                          Chưa có khách thuê trong kỳ
                        </div>
                      ) : (
                        segmentation.map((item) => {
                          const pct = totalRenters > 0 ? (item.count / totalRenters) * 100 : 0;
                          if (pct === 0) return null;
                          return (
                            <div
                              key={item.name}
                              style={{ width: `${pct}%`, backgroundColor: item.color }}
                              title={`${item.name}: ${item.count} (${pct.toFixed(1)}%)`}
                              className="h-full transition-all hover:opacity-90"
                            />
                          );
                        })
                      )}
                    </div>

                    {/* Breakdown List */}
                    <div className="space-y-2 text-xs">
                      {segmentation.map((item) => {
                        const pct = totalRenters > 0 ? ((item.count / totalRenters) * 100).toFixed(1) : "0.0";
                        return (
                          <div key={item.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="text-stone-700 font-medium">{item.name}</span>
                            </div>
                            <div className="font-mono text-stone-900 font-semibold">
                              {item.count}{" "}
                              <span className="text-[11px] text-stone-400 font-normal">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Tier Progress Bars */}
                    {tiers && (
                      <div className="pt-2 border-t border-stone-100 space-y-2">
                        <span className="text-[11px] font-bold text-stone-600 block uppercase tracking-wider">
                          Phân bổ theo số lượt thuê:
                        </span>
                        {[
                          { label: "1 lượt thuê (Khách mới)", count: tiers.singleBooking, color: "bg-stone-500" },
                          { label: "2 - 3 lượt thuê (Khách quen)", count: tiers.twoToThreeBookings, color: "bg-purple-600" },
                          { label: "≥ 4 lượt thuê (Khách VIP)", count: tiers.fourPlusBookings, color: "bg-[#881337]" },
                        ].map((t) => {
                          const pct = totalRenters > 0 ? (t.count / totalRenters) * 100 : 0;
                          return (
                            <div key={t.label} className="space-y-1">
                              <div className="flex justify-between text-[11px]">
                                <span className="text-stone-600">{t.label}</span>
                                <span className="font-mono font-semibold text-stone-900">
                                  {t.count} ({pct.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-stone-100 overflow-hidden">
                                <div
                                  className={`h-full ${t.color}`}
                                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

