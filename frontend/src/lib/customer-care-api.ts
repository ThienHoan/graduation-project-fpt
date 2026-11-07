import { apiRequest, type ApiResponse } from "./api";

export interface CustomerCareKpis {
  activeRentals: number;
  upcomingPickups: number;
  returnsDueToday: number;
  completedBookings: number;
  eligibleVoucherReviews: number;
  dispatchedRemindersToday: number;
  failedDispatchesToday: number;
  systemDate: string;
}

export interface ReminderMilestoneInfo {
  key: "pickup_09h" | "return_12h" | "return_17h";
  name: string;
  scheduleTime: string;
  targetDescription: string;
  cronExpression: string;
  lastRunAt: string | null;
  countToday: number;
  status: "active" | "idle";
}

export interface ReminderRecentDispatch {
  id: string;
  action: string;
  bookingId: string | null;
  bookingCode?: string | null;
  scheduleType?: string | null;
  dispatchedAt: string;
  status: "success" | "failed";
}

export interface ReminderMonitoringData {
  milestones: ReminderMilestoneInfo[];
  recentDispatches: ReminderRecentDispatch[];
}

export type AttentionCategory =
  | "all"
  | "pickup_tomorrow"
  | "return_today"
  | "pending_extension"
  | "overdue"
  | "renting";

export interface CustomerCareAttentionItem {
  id: string;
  bookingCode: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  garmentName: string;
  pickupMethod: string;
  rentalStartDate: string;
  rentalEndDate: string;
  status: string;
  attentionCategory: "pickup_tomorrow" | "return_today" | "pending_extension" | "overdue" | "renting" | "other";
  attentionReason: string;
  hasPendingExtension: boolean;
  isOverdue: boolean;
  overdueDays: number;
}

export interface AttentionListResult {
  items: CustomerCareAttentionItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VoucherProgramMonitoring {
  enabled: boolean;
  safetyWarning: string;
  issuedCount: number;
  policy: {
    minimumCompletedBookings: number;
    discountValue: number;
    discountType: "percentage" | "fixed";
    maxUsage: number;
    validityDays: number;
    codePrefix: string;
    targetTier: string;
  };
  retentionTargetDescription: string;
  canEnable: boolean;
}

export interface EmailTemplateCatalogItem {
  key: string;
  name: string;
  description: string;
  category: "reminder" | "post_completion" | "retention";
  variants?: string[];
}

export interface EmailPreviewResult {
  templateKey: string;
  subject: string;
  title: string;
  html: string;
  text: string;
}

export type NotificationDeliveryStatus = "accepted" | "failed" | "unknown";

export interface NotificationHistoryItem {
  id: string;
  action: string;
  createdAt: string;
  status: NotificationDeliveryStatus;
  templateKey?: string | null;
  notificationType?: string | null;
  bookingId?: string | null;
  bookingCode?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  userId?: string | null;
  channels: string[];
  provider?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  canRetry: boolean;
  retryCount: number;
}

export interface NotificationHistoryResult {
  items: NotificationHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: {
    acceptedCount: number;
    failedCount: number;
    unknownCount: number;
  };
}

export interface NotificationRetryResult {
  success: boolean;
  message: string;
  retryCount: number;
  logId: string;
  status: NotificationDeliveryStatus;
}

export async function fetchCustomerCareKpis(): Promise<ApiResponse<CustomerCareKpis>> {
  return apiRequest<CustomerCareKpis>("/customer-care/kpis", { cache: "no-store" });
}

export async function fetchReminderMonitoring(): Promise<ApiResponse<ReminderMonitoringData>> {
  return apiRequest<ReminderMonitoringData>("/customer-care/reminders", { cache: "no-store" });
}

export async function fetchAttentionList(params?: {
  page?: number;
  limit?: number;
  search?: string;
  category?: AttentionCategory;
}): Promise<ApiResponse<AttentionListResult>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.search) sp.set("search", params.search);
  if (params?.category && params.category !== "all") sp.set("category", params.category);

  const qs = sp.toString();
  return apiRequest<AttentionListResult>(`/customer-care/attention-list${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export async function fetchVoucherProgramStatus(): Promise<ApiResponse<VoucherProgramMonitoring>> {
  return apiRequest<VoucherProgramMonitoring>("/customer-care/vouchers", { cache: "no-store" });
}

export async function fetchEmailTemplatesCatalog(): Promise<ApiResponse<EmailTemplateCatalogItem[]>> {
  return apiRequest<EmailTemplateCatalogItem[]>("/customer-care/email-templates", { cache: "no-store" });
}

export async function fetchEmailPreview(params: {
  templateKey: string;
  variant?: string;
}): Promise<ApiResponse<EmailPreviewResult>> {
  const sp = new URLSearchParams();
  sp.set("templateKey", params.templateKey);
  if (params.variant) sp.set("variant", params.variant);

  return apiRequest<EmailPreviewResult>(`/customer-care/email-preview?${sp.toString()}`, {
    cache: "no-store",
  });
}

export async function fetchNotificationHistory(params?: {
  page?: number;
  limit?: number;
  status?: "all" | "accepted" | "failed" | "unknown";
  type?: string;
  bookingCode?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
}): Promise<ApiResponse<NotificationHistoryResult>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  if (params?.type) sp.set("type", params.type);
  if (params?.bookingCode) sp.set("bookingCode", params.bookingCode);
  if (params?.fromDate) sp.set("fromDate", params.fromDate);
  if (params?.toDate) sp.set("toDate", params.toDate);
  if (params?.search) sp.set("search", params.search);

  const qs = sp.toString();
  return apiRequest<NotificationHistoryResult>(`/customer-care/notification-history${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export async function retryNotification(logId: string): Promise<ApiResponse<NotificationRetryResult>> {
  return apiRequest<NotificationRetryResult>(`/customer-care/notifications/${logId}/retry`, {
    method: "POST",
  });
}

export interface ExtensionHistoryItem {
  id: string;
  bookingId: string;
  bookingCode: string;
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  garmentName: string;
  previousEndDate: string;
  newEndDate: string;
  extraDays: number;
  amount: number;
  status: "pending" | "applied" | "expired" | "cancelled" | "failed";
  paymentStatus?: string | null;
  paymentId?: string | null;
  checkoutUrl?: string | null;
  expiresAt: string;
  appliedAt?: string | null;
  note?: string | null;
  createdAt: string;
  isHoldActive?: boolean;
}

export interface ExtensionHistoryResult {
  items: ExtensionHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ManagerExtensionMonitoringData {
  kpis: {
    totalRequests: number;
    appliedCount: number;
    pendingCount: number;
    expiredCount: number;
    failedCount: number;
    successRate: number;
    totalPaidRevenue: number;
  };
  history: ExtensionHistoryResult;
}

export interface DailyTrendPoint {
  date: string;
  bookingsCount: number;
  completedCount: number;
}

export interface CustomerCareAnalyticsData {
  period: "7d" | "30d" | "90d" | "custom";
  fromDate: string;
  toDate: string;
  systemDate: string;
  bookingAnalytics: {
    totalBookings: number;
    completedBookings: number;
    rentingBookings: number;
    upcomingPickups: number;
    returnsDueToday: number;
    overdueBookings: number;
  };
  reminderAnalytics: {
    pickup09hDispatches: number;
    return12hDispatches: number;
    return17hDispatches: number;
    totalDispatches: number;
    failedDispatches: number;
  };
  emailAnalytics: {
    acceptedCount: number;
    failedCount: number;
    unknownCount: number;
    retryDispatches: number;
  };
  extensionAnalytics: {
    totalRequests: number;
    appliedCount: number;
    pendingCount: number;
    expiredOrFailedCount: number;
    successRate: number;
    totalPaidRevenue: number;
  };
  retentionAnalytics: {
    totalActiveCustomers: number;
    firstTimeRenters: number;
    returningRenters: number;
    retentionRate: number;
    tierDistribution: {
      singleBooking: number;
      twoToThreeBookings: number;
      fourPlusBookings: number;
    };
  };
  voucherAnalytics: {
    issuedCount: number;
    programStatus: "DISABLED";
    safetyWarning: string;
  };
  charts: {
    bookingTrend: DailyTrendPoint[];
    reminderBreakdown: Array<{ name: string; count: number; color: string }>;
    emailStatusBreakdown: Array<{ name: string; count: number; color: string }>;
    extensionBreakdown: Array<{ name: string; count: number; color: string }>;
    customerSegmentation: Array<{ name: string; count: number; color: string }>;
  };
}

export async function fetchCustomerExtensionHistory(params?: {
  page?: number;
  limit?: number;
  status?: string;
  bookingId?: string;
}): Promise<ApiResponse<ExtensionHistoryResult>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  if (params?.bookingId) sp.set("bookingId", params.bookingId);

  const qs = sp.toString();
  return apiRequest<ExtensionHistoryResult>(`/bookings/my-extensions${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export async function fetchManagerExtensionMonitoring(params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<ApiResponse<ManagerExtensionMonitoringData>> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  if (params?.search) sp.set("search", params.search);
  if (params?.fromDate) sp.set("fromDate", params.fromDate);
  if (params?.toDate) sp.set("toDate", params.toDate);

  const qs = sp.toString();
  return apiRequest<ManagerExtensionMonitoringData>(`/customer-care/extensions${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export async function fetchCustomerCareAnalytics(params?: {
  period?: "7d" | "30d" | "90d" | "custom";
  fromDate?: string;
  toDate?: string;
}): Promise<ApiResponse<CustomerCareAnalyticsData>> {
  const sp = new URLSearchParams();
  if (params?.period) sp.set("period", params.period);
  if (params?.fromDate) sp.set("fromDate", params.fromDate);
  if (params?.toDate) sp.set("toDate", params.toDate);

  const qs = sp.toString();
  return apiRequest<CustomerCareAnalyticsData>(`/customer-care/analytics${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}



