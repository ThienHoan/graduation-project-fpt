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
  attentionCategory: Exclude<AttentionCategory, "all"> | "other";
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



