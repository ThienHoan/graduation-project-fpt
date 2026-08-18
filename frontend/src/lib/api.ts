import { readStoredAccessToken } from "./auth";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export type ApiRequestOptions = RequestInit & {
  authToken?: string | null;
};

function buildHeaders(init?: ApiRequestOptions) {
  const headers = new Headers(init?.headers);

  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const accessToken = init?.authToken === undefined ? readStoredAccessToken() : init.authToken;
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return Object.fromEntries(headers.entries());
}

export async function apiRequest<T>(path: string, init?: ApiRequestOptions): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: buildHeaders(init),
    });
  } catch {
    return {
      success: false,
      error: "NETWORK_ERROR",
      message: "Không thể kết nối đến máy chủ. Vui lòng kiểm tra backend đang chạy và thử lại.",
    };
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok) {
    return {
      success: false,
      error: payload?.error ?? "REQUEST_FAILED",
      message: payload?.message ?? `Request failed with status ${response.status}`,
    };
  }

  return payload ?? { success: true };
}

// ---------- Auth API functions ----------

export async function forgotPassword(email: string) {
  return apiRequest<{ email: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(email: string, otp: string, password: string) {
  return apiRequest<{ email: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, otp, password }),
  });
}

// ---------- Garment types ----------

export type GarmentSummary = {
  id: string;
  name: string;
  categoryName: string | null;
  sizeLabel: string | null;
  color: string | null;
  dailyPrice: number;
  depositAmount: number;
  images?: GarmentImage[];
};

export type GarmentGrouped = {
  name: string;
  slug: string;
  garmentId: string;
  categoryName: string | null;
  description: string | null;
  imageUrl: string | null;
  images: GarmentImage[];
  sizes: Array<{
    garmentSizeId: string;
    garmentId?: string;
    sizeLabel: string | null;
    dailyPrice: number;
    depositAmount: number;
  }>;
};

export async function getGarmentsGrouped(search?: string, category?: string) {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  if (category) params.append("category", category);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<GarmentGrouped[]>(`/garments/grouped${query}`);
}

export async function getGarments() {
  return apiRequest<GarmentSummary[]>("/garments");
}

export async function getGarmentById(id: string) {
  return apiRequest<GarmentDetail>(`/garments/${id}`);
}

// ---------- Customer address types ----------

export type CustomerAddress = {
  id: string;
  receiverName: string;
  phone: string;
  line1: string;
  ward: string | null;
  district: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
};

export async function getMyAddresses() {
  return apiRequest<CustomerAddress[]>("/users/me/addresses");
}

// ---------- Shipping / Locations ----------

export type ShippingFeeEstimate = {
  distanceKm: number;
  estimatedFee: number;
  durationMinutes: number;
  distanceText: string;
  durationText: string;
  routeType: "intra" | "adjacent" | "inter";
  routeLabel: string;
  deliveryTimeText: string;
  storeLat: number;
  storeLng: number;
  customerLat: number;
  customerLng: number;
};

export async function getShippingFee(addressId: string) {
  return apiRequest<ShippingFeeEstimate>(`/locations/shipping-fee?addressId=${encodeURIComponent(addressId)}`);
}

export type StoreInfo = {
  name: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  businessHours: string;
};

export async function getStoreInfo() {
  return apiRequest<StoreInfo>("/locations/store-info");
}

// ---------- Delivery map ----------

export type DeliveryPoint = {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  status: string;
  address: string;
  latitude: number;
  longitude: number;
  garmentNames: string;
  rentalStartDate: string;
  rentalEndDate: string;
};

export async function getDeliveryMap() {
  return apiRequest<DeliveryPoint[]>("/bookings/staff/delivery-map");
}

// ---------- Delivery tracking ----------

export type DeliveryTrackData = {
  bookingId: string;
  status: "preparing" | "in_transit" | "arrived";
  progress: number;
  storeLat: number;
  storeLng: number;
  customerLat: number;
  customerLng: number;
  shipperLat: number;
  shipperLng: number;
  customerName: string;
  customerAddress: string;
  estimatedDelivery: string;
};

export async function getDeliveryTrack(bookingId: string) {
  return apiRequest<DeliveryTrackData>(`/bookings/${bookingId}/delivery-track`);
}

// ---------- Booking types ----------

export type BookingItem = {
  id: string;
  garmentId: string;
  garmentSizeId?: string;
  garmentName: string | null;
  imageUrl?: string | null;
  sizeLabel: string | null;
  dailyPrice: number;
  depositAmount: number;
  garmentAssetId?: string | null;
  assetCode?: string | null;
  assetStatus?: string | null;
  conditionNote?: string | null;
};

export type BookingResponse = {
  id: string;
  status: string;
  rentalStartDate: string;
  rentalEndDate: string;
  days: number;
  pickupMethod: string;
  rentalTotal: number;
  depositTotal: number;
  shippingFee?: number;
  penaltyTotal?: number;
  paymentMethod: string;
  paidPaymentMethod?: string | null;
  note: string | null;
  deliveryAddressId?: string | null;
  deliveryAddress?: Omit<CustomerAddress, "isDefault" | "createdAt"> | null;
  createdAt: string;
  items: BookingItem[];
};

export type AvailabilityResponse = {
  garmentId: string;
  available: boolean;
  availableCount: number;
  totalAssets: number;
};

// ---------- Booking API functions ----------

export async function checkAvailability(garmentSizeId: string, startDate: string, endDate: string) {
  return apiRequest<AvailabilityResponse>("/bookings/check-availability", {
    method: "POST",
    body: JSON.stringify({ garmentSizeId, startDate, endDate }),
  });
}

export async function createBooking(payload: {
  garmentSizeIds: string[];
  startDate: string;
  endDate: string;
  pickupMethod?: string;
  deliveryAddressId?: string;
  shippingFee?: number;
  note?: string;
  paymentMethod?: string;
}) {
  return apiRequest<BookingResponse>("/bookings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- Payment API functions ----------

export type PaymentLinkResponse = {
  checkoutUrl: string;
  qrCode: string;
  orderCode: number;
  amount: number;
};

export type PaymentStatusResponse = {
  status: string;
  paid: boolean;
  paidAt?: string;
  orderCode?: string;
};

export async function createPaymentLink(bookingId: string) {
  return apiRequest<PaymentLinkResponse>("/payments/create-link", {
    method: "POST",
    body: JSON.stringify({ bookingId }),
  });
}

export async function getPaymentStatus(bookingId: string) {
  return apiRequest<PaymentStatusResponse>(`/payments/${bookingId}/status`);
}

export async function getMyBookings() {
  return apiRequest<BookingResponse[]>("/bookings/me");
}

export async function getBooking(id: string) {
  return apiRequest<BookingResponse>(`/bookings/${id}`);
}

export async function cancelBooking(id: string) {
  return apiRequest<BookingResponse>(`/bookings/${id}/cancel`, { method: "PATCH" });
}

// ---------- Staff Booking types ----------

export type StaffBookingResponse = BookingResponse & {
  customerName: string | null;
  customerPhone: string | null;
};

// ---------- Staff Booking API functions ----------

export async function getStaffPendingBookings() {
  return apiRequest<StaffBookingResponse[]>("/bookings/staff/pending");
}

export async function getStaffAllBookings() {
  return apiRequest<StaffBookingResponse[]>("/bookings/staff/all");
}

export async function advanceBookingStatus(id: string, status: string, note?: string) {
  return apiRequest<BookingResponse>(`/bookings/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
  });
}

export async function markBookingPaid(
  id: string,
  paymentMethod: string,
  note?: string,
) {
  return apiRequest<BookingResponse>(`/bookings/${id}/mark-paid`, {
    method: "PATCH",
    body: JSON.stringify({ paymentMethod, ...(note ? { note } : {}) }),
  });
}

export async function getStaffReturnBookings() {
  return apiRequest<StaffBookingResponse[]>("/bookings/staff/returns");
}

// ---------- Inspection types ----------

export type InspectionAsset = {
  id: string;
  assetCode: string;
  status: string;
  conditionNote: string | null;
  garment: {
    id: string;
    name: string;
    sizeLabel: string | null;
  };
};

export type InspectionBooking = {
  id: string;
  status: string;
  customerName: null;
  rentalStartDate: string;
  rentalEndDate: string;
  items: {
    id: string;
    garmentId: string;
    garmentName: string | null;
    sizeLabel: string | null;
    assetCode: string | null;
  }[];
};

export type InspectionFindingResponse = {
  id: string;
  findingType: string;
  severity: string;
  description: string | null;
  penaltyAmount: number;
  createdAt: string;
};

export type InspectionPhotoResponse = {
  id: string;
  imageUrl: string;
  note: string | null;
  createdAt: string;
};

export type InspectionSessionResponse = {
  id: string;
  bookingId: string;
  garmentAssetId: string;
  status: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  inspector: {
    id: string;
    fullName: string;
  } | null;
  asset: InspectionAsset;
  booking: InspectionBooking;
  findings: InspectionFindingResponse[];
  photos: InspectionPhotoResponse[];
};

// ---------- Inspection API functions ----------

export async function getBookingInspections(bookingId: string) {
  return apiRequest<InspectionSessionResponse[]>(`/inspections/booking/${bookingId}`);
}

export async function createInspectionSession(payload: {
  bookingId: string;
  garmentAssetId: string;
  note?: string;
}) {
  return apiRequest<InspectionSessionResponse>("/inspections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addInspectionFinding(
  sessionId: string,
  payload: {
    findingType: string;
    severity?: string;
    description?: string;
    penaltyAmount?: number;
  },
) {
  return apiRequest<InspectionFindingResponse>(`/inspections/${sessionId}/findings`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addInspectionPhoto(
  sessionId: string,
  payload: {
    imageUrl: string;
    note?: string;
  },
) {
  return apiRequest<InspectionPhotoResponse>(`/inspections/${sessionId}/photos`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function completeInspection(
  sessionId: string,
  payload: {
    finalAssetStatus: string;
    note?: string;
  },
) {
  return apiRequest<InspectionSessionResponse>(`/inspections/${sessionId}/complete`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// ---------- Asset management types ----------

export type AvailableAsset = {
  id: string;
  assetCode: string;
  status: string;
  conditionNote: string | null;
};

// ---------- Asset API functions ----------

export async function getAvailableAssets(garmentId: string) {
  return apiRequest<AvailableAsset[]>(`/garments/${garmentId}/assets/available`);
}

export async function assignAssetToBookingItem(
  bookingId: string,
  itemId: string,
  garmentAssetId: string,
) {
  return apiRequest<BookingResponse>(`/bookings/${bookingId}/items/${itemId}/assign-asset`, {
    method: "PATCH",
    body: JSON.stringify({ garmentAssetId }),
  });
}

export async function getStaffBooking(id: string) {
  return apiRequest<StaffBookingResponse>(`/bookings/staff/${id}`);
}

export async function getStaffCompletedRefundBookings() {
  return apiRequest<StaffBookingResponse[]>("/bookings/staff/completed-refunds");
}

// ---------- Refund types ----------

export type RefundResponse = {
  id: string;
  bookingId: string;
  amount: number;
  status: string;
  refundMethod: string;
  reason: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  proofImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  booking: {
    id: string;
    depositTotal: number;
    penaltyTotal: number;
    pickupMethod: string;
    customerId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    items?: Array<{
      id: string;
      garmentName: string | null;
      sizeLabel: string | null;
      imageUrl: string | null;
    }>;
  };
  processedBy: string | null;
};

export type RefundCalculationResponse = {
  bookingId: string;
  depositTotal: number;
  penaltyTotal: number;
  refundAmount: number;
};

export type CustomerRefundResponse = {
  id: string;
  bookingId: string;
  amount: number;
  status: string;
  refundMethod: string;
  reason: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  proofImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------- Refund API functions ----------

export async function calculateRefund(bookingId: string) {
  return apiRequest<RefundCalculationResponse>(`/refunds/calculate/${bookingId}`, {
    method: "POST",
  });
}

export async function createRefund(payload: {
  bookingId: string;
  refundMethod: "cash" | "bank_transfer";
  reason?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
}) {
  return apiRequest<RefundResponse>("/refunds", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function approveRefund(
  refundId: string,
  payload: {
    status: "refunded" | "partially_refunded";
    proofImageUrl?: string;
    note?: string;
  },
) {
  return apiRequest<RefundResponse>(`/refunds/${refundId}/approve`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// Huỷ một yêu cầu hoàn cọc đang chờ duyệt (vd số tiền không còn khớp do phạt đổi)
export async function rejectRefund(refundId: string, reason?: string) {
  return apiRequest<{ id: string; status: string }>(`/refunds/${refundId}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  });
}

// Đơn chờ hoàn cọc nhưng phạt >= cọc → đóng đơn về hoàn tất, không tạo refund
export async function closeBookingWithoutRefund(bookingId: string) {
  return apiRequest<{ bookingId: string; status: string }>(`/refunds/close-without-refund/${bookingId}`, {
    method: "POST",
  });
}

export async function getPendingStaffRefunds() {
  return apiRequest<RefundResponse[]>("/refunds/staff/pending");
}

export async function getPendingManagerRefunds() {
  return apiRequest<RefundResponse[]>("/refunds/manager/pending");
}

export async function getBookingRefunds(bookingId: string) {
  return apiRequest<RefundResponse[]>(`/refunds/booking/${bookingId}`);
}

export async function getRefund(id: string) {
  return apiRequest<RefundResponse>(`/refunds/${id}`);
}

export async function getCustomerRefund(bookingId: string) {
  return apiRequest<CustomerRefundResponse[]>(`/refunds/customer/booking/${bookingId}`);
}

// ---------- Asset maintenance API functions ----------

export type AssetNeedingProcessing = {
  id: string;
  assetCode: string;
  status: string;
  conditionNote: string | null;
  garment: {
    id: string;
    name: string;
    sizeLabel: string | null;
  };
  hasOpenTicket: boolean;
};

export async function markAssetReady(assetId: string) {
  return apiRequest<{ id: string; assetCode: string; status: string; conditionNote: string | null }>(
    `/inspections/assets/${assetId}/mark-ready`,
    { method: "PATCH" },
  );
}

export async function getAssetsNeedingProcessing() {
  return apiRequest<AssetNeedingProcessing[]>("/inspections/assets/needing-processing");
}

// ---------- Asset management types (extended) ----------

export type AssetDetail = {
  id: string;
  garmentId: string;
  garmentName: string;
  sizeLabel: string | null;
  dailyPrice: number;
  assetCode: string;
  status: string;
  conditionNote: string | null;
  purchaseCost: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AssetInspectionHistory = {
  id: string;
  bookingId: string;
  status: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  inspectorName: string | null;
  bookingDates: { start: string; end: string };
  findings: {
    id: string;
    findingType: string;
    severity: string;
    penaltyAmount: number;
    createdAt: string;
  }[];
};

// ---------- Asset API functions (extended) ----------

export async function getAssetsByGarment(garmentId: string) {
  return apiRequest<AssetDetail[]>(`/assets/by-garment/${garmentId}`);
}

export async function getAssetById(id: string) {
  return apiRequest<AssetDetail>(`/assets/${id}`);
}

export async function getAssetInspectionHistory(assetId: string) {
  return apiRequest<AssetInspectionHistory[]>(`/assets/${assetId}/inspections`);
}

export async function updateAssetStatus(
  assetId: string,
  status: string,
  note?: string,
) {
  return apiRequest<AssetDetail>(`/assets/${assetId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
  });
}

// ---------- Laundry types ----------

export type LaundryTicketResponse = {
  id: string;
  garmentAssetId: string;
  assetCode: string;
  garmentName: string;
  bookingId: string | null;
  bookingCode: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
};

export async function getLaundryTickets() {
  return apiRequest<LaundryTicketResponse[]>("/inspections/laundry");
}

export async function completeLaundryTicket(
  ticketId: string,
  note?: string,
) {
  return apiRequest<LaundryTicketResponse>(`/inspections/laundry/${ticketId}/complete`, {
    method: "PATCH",
    body: JSON.stringify({ ...(note ? { note } : {}) }),
  });
}

// ---------- Maintenance types ----------

export type MaintenanceJobResponse = {
  id: string;
  garmentAssetId: string;
  assetCode: string;
  garmentName: string;
  status: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
};

export async function getMaintenanceJobs() {
  return apiRequest<MaintenanceJobResponse[]>("/inspections/maintenance");
}

export async function completeMaintenanceJob(
  jobId: string,
  status: string,
  note?: string,
) {
  return apiRequest<MaintenanceJobResponse>(`/inspections/maintenance/${jobId}/complete`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
  });
}

// ---------- Inspection log types ----------

export type InspectionLogEntry = {
  id: string;
  bookingId: string;
  assetCode: string;
  garmentName: string;
  status: string;
  inspectorName: string | null;
  findingsCount: number;
  totalPenalty: number;
  createdAt: string;
  completedAt: string | null;
};

export async function getInspectionLog() {
  return apiRequest<InspectionLogEntry[]>("/inspections/log");
}

// ---------- Garment management (Manager) ----------

export type GarmentImage = {
  id: string;
  imageUrl: string;
  altText: string | null;
  sortOrder: number;
};

export type GarmentDetail = GarmentSummary & {
  description: string | null;
  categoryId: string | null;
  color: string | null;
  isActive: boolean;
  images: GarmentImage[];
};

export type GarmentCategory = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export async function getGarmentCategories() {
  return apiRequest<GarmentCategory[]>("/garments/categories");
}

export async function getGarmentSizes() {
  return apiRequest<string[]>("/garments/sizes");
}

export async function createGarmentSize(sizeLabel: string) {
  return apiRequest<{ sizeLabel: string }>("/garments/sizes", {
    method: "POST",
    body: JSON.stringify({ sizeLabel }),
  });
}

export async function createGarment(payload: {
  name: string;
  categoryId?: string;
  description?: string;
  sizeLabel?: string;
  color?: string;
  dailyPrice: number;
  depositAmount: number;
  isActive?: boolean;
}) {
  return apiRequest<GarmentDetail>("/garments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateGarment(id: string, payload: {
  name?: string;
  categoryId?: string;
  description?: string;
  sizeLabel?: string;
  color?: string;
  dailyPrice?: number;
  depositAmount?: number;
  isActive?: boolean;
}) {
  return apiRequest<GarmentDetail>(`/garments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteGarment(id: string) {
  return apiRequest<{ id: string; deleted: boolean }>(`/garments/${id}`, {
    method: "DELETE",
  });
}

export async function addGarmentImage(garmentId: string, payload: {
  imageUrl: string;
  altText?: string;
  sortOrder?: string;
}) {
  return apiRequest<GarmentImage>(`/garments/${garmentId}/images`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function removeGarmentImage(garmentId: string, imageId: string) {
  return apiRequest<{ id: string; deleted: boolean }>(`/garments/${garmentId}/images/${imageId}`, {
    method: "DELETE",
  });
}

export async function createGarmentCategory(name: string, description?: string) {
  return apiRequest<GarmentCategory>("/garments/categories", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

// ---------- Asset management (Manager) - extended ----------

export async function getAllAssets(status?: string) {
  const query = status ? `?status=${status}` : "";
  return apiRequest<AssetDetail[]>(`/assets${query}`);
}

export async function createAsset(payload: {
  garmentId: string;
  assetCode: string;
  conditionNote?: string;
  purchaseCost?: number;
}) {
  return apiRequest<AssetDetail>("/assets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- Admin API ----------

export type AdminSummaryCard = {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: "rose" | "emerald" | "amber" | "slate";
};

export type AdminQueueCard = {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: "rose" | "emerald" | "amber" | "slate";
};

export type AdminOverviewResponse = {
  summary: AdminSummaryCard[];
  queues: AdminQueueCard[];
  assetBreakdown: { status: string; label: string; count: number }[];
  bookingBreakdown: { status: string; label: string; count: number }[];
  recentActivity: AdminAuditLogEntry[];
  settingsSnapshot: AdminSettingEntry[];
};

export type AdminAuditLogEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: any;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  createdAt: string;
  summary: string;
};

export type AdminUserEntry = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isEmailVerified: boolean;
  fullName: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  bookingCount: number;
};

export type AdminSettingEntry = {
  key: string;
  label: string;
  description: string;
  kind: "number" | "text" | "json";
  value: any;
  updatedAt: string | null;
  isDefault: boolean;
};

export async function getAdminOverview() {
  return apiRequest<AdminOverviewResponse>("/admin/overview");
}

export async function getAdminUsers(query?: { search?: string; role?: string; status?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (query?.search) params.append("search", query.search);
  if (query?.role) params.append("role", query.role);
  if (query?.status) params.append("status", query.status);
  if (query?.page) params.append("page", String(query.page));
  if (query?.limit) params.append("limit", String(query.limit));
  
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ items: AdminUserEntry[]; total: number; page: number; limit: number }>(`/admin/users${queryStr}`);
}

export async function updateAdminUser(userId: string, payload: { fullName?: string | null; phone?: string | null; role?: string; isActive?: boolean }) {
  return apiRequest<AdminUserEntry>(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getAdminAuditLogs(query?: { search?: string; action?: string; entityType?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (query?.search) params.append("search", query.search);
  if (query?.action) params.append("action", query.action);
  if (query?.entityType) params.append("entityType", query.entityType);
  if (query?.page) params.append("page", String(query.page));
  if (query?.limit) params.append("limit", String(query.limit));
  
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ items: AdminAuditLogEntry[]; total: number; page: number; limit: number }>(`/admin/audit-logs${queryStr}`);
}

export async function getAdminSettings() {
  return apiRequest<AdminSettingEntry[]>("/admin/settings");
}

export async function updateAdminSetting(key: string, value: any) {
  return apiRequest<AdminSettingEntry>(`/admin/settings/${key}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
}

// ---------- Pricing (điều chỉnh giá AI) ----------

export type PriceCalendarEntry = {
  id: string;
  name: string;
  occasionType: "holiday" | "occasion" | "peak_season" | "off_season";
  fromDate: string;
  toDate: string;
  adjustmentPercent: number;
  priority: number;
  garmentKeywords: string[];
  isActive: boolean;
  note: string | null;
  createdAt: string;
};

export type PriceSuggestionEntry = {
  id: string;
  garmentSizeId: string;
  garmentId: string | null;
  garmentName: string | null;
  sizeLabel: string | null;
  calendarId: string | null;
  calendarName: string | null;
  fromDate: string;
  toDate: string;
  basePrice: number;
  purchaseCost: number;
  targetRentalDays: number;
  recommendedAdjustmentPct: number;
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  validPrice: number;
  demandPressure: number | null;
  bookingPressure: number | null;
  confidence: number | null;
  reason: Record<string, unknown>;
  source: "ai" | "owner";
  status: "pending" | "approved" | "rejected" | "deactivated";
  reviewedBy: string | null;
  reviewedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
};

export type PricePeriodEntry = {
  id: string;
  garmentSizeId: string;
  garmentName: string | null;
  sizeLabel: string | null;
  fromDate: string;
  toDate: string;
  dailyPrice: number;
  source: "base" | "ai_suggestion" | "owner";
  sourceSuggestionId: string | null;
  occasionType: string | null;
  eventName: string | null;
  isActive: boolean;
  createdAt: string;
};

export type PriceCalendarPayload = {
  name: string;
  occasionType: string;
  fromDate: string;
  toDate: string;
  adjustmentPercent?: number;
  priority?: number;
  garmentKeywords?: string[];
  isActive?: boolean;
  note?: string;
};

export type GenerateSuggestionsResult = {
  generated: number;
  skipped: Array<{
    sizeId?: string;
    error?: string;
    note?: string;
    garmentName?: string | null;
    sizeLabel?: string | null;
  }>;
  suggestions: string[];
  window: { from: string; to: string; calendarId: string | null };
};

export async function getPricingCalendar(query?: {
  activeOnly?: boolean;
  upcoming?: boolean;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (query?.activeOnly) params.append("activeOnly", "true");
  if (query?.upcoming) params.append("upcoming", "true");
  if (query?.search) params.append("search", query.search);
  if (query?.from) params.append("from", query.from);
  if (query?.to) params.append("to", query.to);
  if (query?.page) params.append("page", String(query.page));
  if (query?.limit) params.append("limit", String(query.limit));
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ items: PriceCalendarEntry[]; total: number; page: number; limit: number }>(`/pricing/calendar${queryStr}`);
}

export async function createPricingCalendar(payload: PriceCalendarPayload) {
  return apiRequest<PriceCalendarEntry>("/pricing/calendar", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePricingCalendar(id: string, payload: Partial<PriceCalendarPayload>) {
  return apiRequest<PriceCalendarEntry>(`/pricing/calendar/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function removePricingCalendar(id: string) {
  return apiRequest<{ id: string; deactivated: boolean }>(`/pricing/calendar/${id}`, {
    method: "DELETE",
  });
}

export async function getPricingSuggestions(query?: {
  status?: string;
  calendarId?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (query?.status) params.append("status", query.status);
  if (query?.calendarId) params.append("calendarId", query.calendarId);
  if (query?.search) params.append("search", query.search);
  if (query?.from) params.append("from", query.from);
  if (query?.to) params.append("to", query.to);
  if (query?.page) params.append("page", String(query.page));
  if (query?.limit) params.append("limit", String(query.limit));
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ items: PriceSuggestionEntry[]; total: number; page: number; limit: number }>(`/pricing/suggestions${queryStr}`);
}

export async function generatePricingSuggestions(payload: { calendarId?: string; from?: string; to?: string }) {
  return apiRequest<GenerateSuggestionsResult>("/pricing/suggestions/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createPricingSuggestion(payload: {
  garmentSizeIds: string[];
  from: string;
  to: string;
  validPrice: number;
  calendarId?: string;
}) {
  return apiRequest<{
    created: Array<{ id: string }>;
    skipped: Array<{ sizeId: string; name: string | null; sizeLabel: string | null; error: string }>;
  }>("/pricing/suggestions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePricingSuggestionPrice(id: string, validPrice: number) {
  return apiRequest<{ id: string; suggestion: PriceSuggestionEntry }>(`/pricing/suggestions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ validPrice }),
  });
}

export async function approvePricingSuggestion(id: string) {
  return apiRequest<{ id: string; status: string }>(`/pricing/suggestions/${id}/approve`, { method: "POST" });
}

export async function rejectPricingSuggestion(id: string) {
  return apiRequest<{ id: string; status: string }>(`/pricing/suggestions/${id}/reject`, { method: "POST" });
}

export async function bulkPricingSuggestionAction(ids: string[], action: "approve" | "reject") {
  return apiRequest<{
    action: string;
    succeeded: string[];
    failed: Array<{ id: string; reason: string }>;
    successCount: number;
    failureCount: number;
  }>(`/pricing/suggestions/bulk`, { method: "POST", body: JSON.stringify({ ids, action }) });
}

export async function deactivatePricingSuggestion(id: string) {
  return apiRequest<{ id: string; status: string }>(`/pricing/suggestions/${id}/deactivate`, { method: "POST" });
}

export async function getPricingPeriods(query?: {
  sizeId?: string;
  activeOnly?: boolean;
  endDateGte?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (query?.sizeId) params.append("sizeId", query.sizeId);
  if (query?.activeOnly) params.append("activeOnly", "true");
  if (query?.endDateGte) params.append("endDateGte", query.endDateGte);
  if (query?.search) params.append("search", query.search);
  if (query?.from) params.append("from", query.from);
  if (query?.to) params.append("to", query.to);
  if (query?.page) params.append("page", String(query.page));
  if (query?.limit) params.append("limit", String(query.limit));
  const queryStr = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<{ items: PricePeriodEntry[]; total: number; page: number; limit: number }>(`/pricing/periods${queryStr}`);
}

export async function deactivatePricingPeriod(id: string) {
  return apiRequest<{ id: string; isActive: boolean }>(`/pricing/periods/${id}/deactivate`, { method: "POST" });
}

// ---------- Notifications ----------

export type NotificationItem = {
  id: string;
  userId: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  isRead: boolean;
};

export type NotificationCenterResponse = {
  unreadCount: number;
  notifications: NotificationItem[];
};

export type NotificationPreferences = {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  bookingUpdatesEnabled: boolean;
  paymentUpdatesEnabled: boolean;
  reminderEnabled: boolean;
  marketingEnabled: boolean;
};

export type NotificationSettings = {
  provider: "mock" | "smtp";
  smtp: {
    service: string | null;
    host: string | null;
    port: number | null;
    secure: boolean;
    user: string | null;
    fromEmail: string | null;
    fromName: string | null;
    replyTo: string | null;
    passwordConfigured: boolean;
  };
};

export type NotificationTemplate = {
  subject: string;
  title: string;
  body: string;
  channels: ("email" | "inApp")[];
  enabled: boolean;
};

export type NotificationTemplatesMap = Record<string, NotificationTemplate>;

export type NotificationLogEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actorId: string | null;
};

export async function getMyNotifications(limit?: number) {
  const query = typeof limit === "number" && Number.isFinite(limit) ? `?limit=${limit}` : "";
  return apiRequest<NotificationCenterResponse>(`/notifications/me${query}`);
}

export async function markMyNotificationRead(id: string) {
  return apiRequest<NotificationItem>(`/notifications/me/${id}/read`, { method: "PATCH" });
}

export async function markAllMyNotificationsRead() {
  return apiRequest<{ updatedCount: number }>("/notifications/me/read-all", { method: "PATCH" });
}

export async function getMyNotificationPreferences() {
  return apiRequest<NotificationPreferences>("/notifications/me/preferences");
}

export async function updateMyNotificationPreferences(payload: Partial<NotificationPreferences>) {
  return apiRequest<NotificationPreferences>("/notifications/me/preferences", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getNotificationSettings() {
  return apiRequest<NotificationSettings>("/notifications/admin/settings");
}

export async function updateNotificationSettings(payload: {
  provider?: "mock" | "smtp";
  smtpService?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}) {
  return apiRequest<NotificationSettings>("/notifications/admin/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getNotificationTemplates() {
  return apiRequest<NotificationTemplatesMap>("/notifications/admin/templates");
}

export async function updateNotificationTemplates(payload: NotificationTemplatesMap) {
  return apiRequest<NotificationTemplatesMap>("/notifications/admin/templates", {
    method: "PUT",
    body: JSON.stringify({ templates: payload }),
  });
}

export async function getNotificationLogs(limit?: number) {
  const query = typeof limit === "number" && Number.isFinite(limit) ? `?limit=${limit}` : "";
  return apiRequest<NotificationLogEntry[]>(`/notifications/admin/logs${query}`);
}

export async function sendTestNotification(payload: {
  email: string;
  templateKey: string;
  recipientName?: string;
  data?: Record<string, unknown>;
}) {
  return apiRequest<{ templateKey: string; channels: string[]; notificationId: string | null; emailStatus: unknown }>(
    "/notifications/admin/test-email",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

// ---------- Reviews ----------

export type ReviewResponse = {
  id: string;
  customerId: string;
  garmentId: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  status: "public" | "hidden";
  images: string[];
  video: string | null;
  staffReply: string | null;
  staffReplyAt: string | null;
  staffRepliedBy: string | null;
  isReported: boolean;
  reportedReason: string | null;
  reportedAt: string | null;
  reportedBy: string | null;
  editCount: number;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  garment?: {
    id: string;
    name: string;
    images: { imageUrl: string }[];
  };
  customer?: {
    id: string;
    email?: string;
    profile?: { fullName: string | null } | null;
  } | null;
};

export async function createReview(payload: { garmentId: string; bookingId?: string; rating: number; comment?: string; images?: string[]; video?: string; }) {
  return apiRequest<ReviewResponse>("/reviews", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getGarmentReviews(garmentId: string) {
  return apiRequest<{ reviews: ReviewResponse[]; averageRating: number; total: number }>(`/reviews/garment/${garmentId}`);
}

export async function getMyReviews() {
  return apiRequest<ReviewResponse[]>("/reviews/me");
}

export type StaffReviewResponse = ReviewResponse & {
  garment?: { id: string; name: string } | null;
  customer?: { id: string; profile?: { fullName: string | null } | null } | null;
  repliedByUser?: { id: string; profile?: { fullName: string | null } | null } | null;
  reportedByUser?: { id: string; profile?: { fullName: string | null } | null } | null;
};

export async function getStaffReviews() {
  return apiRequest<StaffReviewResponse[]>("/reviews/staff/all");
}

export async function replyToReview(reviewId: string, reply: string) {
  return apiRequest<StaffReviewResponse>(`/reviews/${reviewId}/reply`, {
    method: "POST",
    body: JSON.stringify({ reply }),
  });
}

export async function reportReview(reviewId: string, reason: string) {
  return apiRequest<StaffReviewResponse>(`/reviews/${reviewId}/report`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function hideReview(reviewId: string, reason?: string) {
  return apiRequest<StaffReviewResponse>(`/reviews/${reviewId}/hide`, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  });
}

export async function updateReview(id: string, payload: { rating?: number; comment?: string; images?: string[]; video?: string; }) {
  return apiRequest<ReviewResponse>(`/reviews/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
