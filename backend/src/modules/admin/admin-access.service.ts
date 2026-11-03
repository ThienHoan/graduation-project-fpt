import { Injectable, RequestMethod } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { AppRole } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { ADMIN_AREA_LABELS, ADMIN_ROLE_LABELS, ADMIN_ROLE_OPTIONS } from "./admin.constants";

type AreaAccess = { area: string; label: string; read: number; write: number };

type IntegrationEntry = {
  key: string;
  label: string;
  description: string;
  configured: boolean;
  details: { label: string; value: string }[];
};

const READ_METHODS = new Set<number>([RequestMethod.GET, RequestMethod.HEAD, RequestMethod.OPTIONS]);

function hostOf(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Read-only views for the admin portal that are derived from the running app:
 * - the role/permission matrix is built from the real `@Roles()` metadata of every controller route,
 * - integration status only reports whether env-based secrets are present, never their values.
 */
@Injectable()
export class AdminAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async getRoleMatrix() {
    const areasByRole = this.collectAreasByRole();
    const [total, active] = await Promise.all([
      this.prisma.userAccount.groupBy({ by: ["role"], _count: { _all: true } }),
      this.prisma.userAccount.groupBy({ by: ["role"], where: { isActive: true }, _count: { _all: true } }),
    ]);
    const totalMap = new Map(total.map((row) => [row.role, row._count._all] as const));
    const activeMap = new Map(active.map((row) => [row.role, row._count._all] as const));

    return ok({
      roles: ADMIN_ROLE_OPTIONS.map((role) => ({
        role,
        label: ADMIN_ROLE_LABELS[role],
        userCount: totalMap.get(role) ?? 0,
        activeCount: activeMap.get(role) ?? 0,
        areas: areasByRole.get(role) ?? [],
      })),
    });
  }

  getIntegrations() {
    const has = (key: string) => Boolean(this.config.get<string>(key)?.trim());
    const text = (key: string) => this.config.get<string>(key)?.trim() || "Chưa khai báo";
    const status = (key: string) => (has(key) ? "Đã cấu hình" : "Chưa cấu hình");

    const integrations: IntegrationEntry[] = [
      {
        key: "ai",
        label: "AI trợ lý & tư vấn",
        description: "Mô hình ngôn ngữ phục vụ chatbot và tư vấn giá. Khóa API chỉ đọc từ biến môi trường của máy chủ.",
        configured: has("AI_API_KEY") && has("AI_MODEL"),
        details: [
          { label: "Mô hình", value: text("AI_MODEL") },
          { label: "Mô hình dự phòng", value: text("AI_FALLBACK_MODEL") },
          { label: "Máy chủ", value: hostOf(this.config.get<string>("AI_BASE_URL")) ?? "Mặc định" },
          { label: "Khóa API", value: status("AI_API_KEY") },
        ],
      },
      {
        key: "vision",
        label: "AI giám định ảnh trả hàng",
        description: "Mô hình thị giác (OpenRouter) dùng khi nhân viên kiểm tra tình trạng trang phục.",
        configured: has("OPENROUTER_API_KEY") && has("OPENROUTER_VISION_MODEL"),
        details: [
          { label: "Mô hình", value: text("OPENROUTER_VISION_MODEL") },
          { label: "Khóa API", value: status("OPENROUTER_API_KEY") },
        ],
      },
      {
        key: "payos",
        label: "Cổng thanh toán PayOS",
        description: "Thông tin xác thực PayOS được giữ trong biến môi trường, không lưu trong cơ sở dữ liệu.",
        configured: has("PAYOS_CLIENT_ID") && has("PAYOS_API_KEY") && has("PAYOS_CHECKSUM_KEY"),
        details: [
          { label: "Client ID", value: status("PAYOS_CLIENT_ID") },
          { label: "API key", value: status("PAYOS_API_KEY") },
          { label: "Checksum key", value: status("PAYOS_CHECKSUM_KEY") },
        ],
      },
      {
        key: "smtp",
        label: "Email (SMTP)",
        description: "Dùng để gửi email xác minh tài khoản và thông báo đơn thuê.",
        configured: has("SMTP_EMAIL") && has("SMTP_PASSWORD"),
        details: [
          { label: "Dịch vụ", value: text("SMTP_SERVICE") },
          { label: "Tài khoản gửi", value: text("SMTP_EMAIL") },
          { label: "Mật khẩu", value: status("SMTP_PASSWORD") },
        ],
      },
    ];

    return ok(integrations);
  }

  private collectAreasByRole() {
    const counters = new Map<AppRole, Map<string, { read: number; write: number }>>();

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype;
      if (!controller || typeof controller !== "function") continue;

      const rawPath = Reflect.getMetadata("path", controller) as string | string[] | undefined;
      const basePath = (Array.isArray(rawPath) ? rawPath[0] : rawPath) ?? "";
      const area = basePath.replace(/^\/+/, "").split("/")[0] || "root";

      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const handler = proto[name];
        if (typeof handler !== "function") continue;

        const httpMethod = Reflect.getMetadata("method", handler) as number | undefined;
        if (httpMethod === undefined) continue; // not a route handler

        const roles = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [handler, controller]);
        if (!roles || roles.length === 0) continue; // open to any authenticated (or public) caller

        for (const role of roles) {
          const perRole = counters.get(role) ?? new Map<string, { read: number; write: number }>();
          const entry = perRole.get(area) ?? { read: 0, write: 0 };
          if (READ_METHODS.has(httpMethod)) entry.read += 1;
          else entry.write += 1;
          perRole.set(area, entry);
          counters.set(role, perRole);
        }
      }
    }

    const result = new Map<AppRole, AreaAccess[]>();
    for (const [role, areas] of counters) {
      result.set(
        role,
        [...areas.entries()]
          .map(([area, counts]) => ({ area, label: ADMIN_AREA_LABELS[area] ?? area, ...counts }))
          .sort((a, b) => a.label.localeCompare(b.label, "vi")),
      );
    }
    return result;
  }
}
