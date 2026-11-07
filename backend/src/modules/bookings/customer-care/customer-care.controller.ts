import { Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ok } from "../../../common/api-response";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  AttentionListQueryDto,
  CustomerCareAnalyticsQueryDto,
  EmailPreviewQueryDto,
  ManagerExtensionQueryDto,
  NotificationHistoryQueryDto,
} from "./customer-care.dto";
import { CustomerCareService } from "./customer-care.service";
import { CustomerNotificationPreferencesPolicy } from "./customer-notification-preferences.policy";
import { NotificationRetryService } from "./notification-retry.service";

@Controller("customer-care")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "manager_owner", "staff")
export class CustomerCareController {
  constructor(
    private readonly customerCareService: CustomerCareService,
    private readonly notificationRetryService: NotificationRetryService,
  ) {}

  /**
   * KPI chăm sóc khách hàng & tự động hóa (Active rentals, Pickups mai, Returns hôm nay...)
   */
  @Get("kpis")
  async getKpis() {
    const data = await this.customerCareService.getKpis();
    return ok(data);
  }

  /**
   * Giám sát các mốc nhắc lịch tự động (09:00, 12:00, 17:00) & lịch sử gửi gần nhất
   */
  @Get("reminders")
  async getReminderMonitoring() {
    const data = await this.customerCareService.getReminderMonitoring();
    return ok(data);
  }

  /**
   * Danh sách đơn hàng cần chăm sóc & chú ý (nhận mai, trả hôm nay, pending extension, quá hạn)
   */
  @Get("attention-list")
  async getAttentionList(@Query() query: AttentionListQueryDto) {
    const data = await this.customerCareService.getAttentionList(query);
    return ok(data);
  }

  /**
   * Giám sát chính sách & trạng thái chương trình Voucher Tri Ân (Safety First: canEnable = false)
   */
  @Get("vouchers")
  async getVoucherProgramStatus() {
    const data = await this.customerCareService.getVoucherProgramStatus();
    return ok(data);
  }

  /**
   * WORKSTREAM B: Danh mục 5 template email Cổ Phục Hoàng Thành
   */
  @Get("email-templates")
  getEmailTemplatesCatalog() {
    const catalog = this.customerCareService.getEmailTemplatesCatalog();
    return ok(catalog);
  }

  /**
   * WORKSTREAM B: Xem trước nội dung template email (HTML & Plain Text)
   */
  @Get("email-preview")
  getEmailPreview(@Query() query: EmailPreviewQueryDto) {
    const preview = this.customerCareService.getEmailPreview(query);
    return ok(preview);
  }

  /**
   * WORKSTREAM B: Lịch sử thông báo chăm sóc khách hàng (AuditLog & Notification)
   */
  @Get("notification-history")
  async getNotificationHistory(@Query() query: NotificationHistoryQueryDto) {
    const history = await this.customerCareService.getNotificationHistory(query);
    return ok(history);
  }

  /**
   * WORKSTREAM C: Gửi lại thông báo thất bại một cách an toàn (Idempotent Retry).
   * Phân quyền: CHỈ admin và manager_owner mới được quyền thực hiện retry.
   */
  @Post("notifications/:logId/retry")
  @Roles("admin", "manager_owner")
  async retryNotification(
    @Param("logId") logId: string,
    @Req() req: any,
  ) {
    const actorId = req.user?.id;
    const result = await this.notificationRetryService.retryNotification(logId, actorId);
    return ok(result);
  }

  /**
   * WORKSTREAM D: Chính sách phân loại Transactional vs Promotional & Tình trạng Schema Gap.
   */
  @Get("preferences/policy")
  getPreferencesPolicy() {
    const summary = CustomerNotificationPreferencesPolicy.getPolicySummary();
    return ok(summary);
  }

  /**
   * WORKSTREAM A (Manager): Giám sát lịch sử gia hạn thuê và tỷ lệ thành công.
   */
  @Get("extensions")
  async getExtensionMonitoring(@Query() query: ManagerExtensionQueryDto) {
    const data = await this.customerCareService.getExtensionMonitoring(query);
    return ok(data);
  }

  /**
   * WORKSTREAM B: Báo cáo phân tích hiệu quả chăm sóc khách hàng (Customer Care Analytics).
   */
  @Get("analytics")
  async getAnalytics(@Query() query: CustomerCareAnalyticsQueryDto) {
    const data = await this.customerCareService.getAnalytics(query);
    return ok(data);
  }
}
