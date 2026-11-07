/**
 * Type definitions for Cổ Phục Hoàng Thành AI Professional Email System.
 *
 * NOTE:
 * - Pure data interfaces: No dependencies on database or transport logic.
 * - Adheres to brand guidelines: Imperial Gold (#D4AF37), Royal Crimson (#881337).
 */

export type EmailTemplateKey =
  | "booking.pickup_reminder"
  | "booking.return_reminder"
  | "booking.extension_applied"
  | "booking.thank_you_voucher"
  | "booking.review_invite";

export interface EmailRenderResult {
  templateKey: EmailTemplateKey;
  subject: string;
  title: string;
  html: string;
  text: string;
}

export interface StoreContactInfo {
  storeAddress?: string | null;
  storePhone?: string | null;
  businessHours?: string | null;
  supportEmail?: string | null;
  websiteUrl?: string | null;
}

export interface PickupReminderEmailData {
  customerName?: string | null;
  bookingCode: string;
  garmentName?: string | null;
  pickupDate: string; // DD/MM/YYYY or YYYY-MM-DD
  pickupMethod?: "store_pickup" | "delivery" | string | null;
  storeInfo?: StoreContactInfo;
  careInstructions?: string[];
  ctaUrl?: string | null;
}

export interface ReturnReminderEmailData {
  customerName?: string | null;
  bookingCode: string;
  garmentName?: string | null;
  rentalEndDate: string; // DD/MM/YYYY or YYYY-MM-DD
  scheduleType?: "daily" | "before_close";
  pickupMethod?: "store_pickup" | "delivery" | string | null;
  storeInfo?: StoreContactInfo;
  accessoryCount?: number | null;
  accessoriesList?: string[];
  hasPendingExtension?: boolean;
  overdueFeePerDay?: number | null;
  ctaUrl?: string | null;
}

export interface ExtensionAppliedEmailData {
  customerName?: string | null;
  bookingCode: string;
  garmentName?: string | null;
  originalEndDate: string; // DD/MM/YYYY
  newEndDate: string; // DD/MM/YYYY
  extensionDays: number;
  extensionFee: number;
  paymentStatus: "paid" | "pending" | string;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  ctaUrl?: string | null;
  storeInfo?: StoreContactInfo;
}

export interface ThankYouVoucherEmailData {
  customerName?: string | null;
  bookingCode: string;
  garmentName?: string | null;
  programEnabled?: boolean; // Safety Gate: Defaults to false
  voucherCode?: string | null;
  discountType?: "percentage" | "fixed" | null;
  discountValue?: number | null;
  minOrderValue?: number | null;
  maxDiscountAmount?: number | null;
  expiresAt?: Date | string | null;
  ctaUrl?: string | null;
  storeInfo?: StoreContactInfo;
}

export interface ReviewInviteEmailData {
  customerName?: string | null;
  bookingCode: string;
  garmentName?: string | null;
  completedDate?: string | null;
  ctaUrl?: string | null;
  storeInfo?: StoreContactInfo;
}

