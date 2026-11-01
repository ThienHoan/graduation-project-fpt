import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ok } from "../../../common/api-response";
import type { AuthenticatedUser } from "../../auth/auth-user";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { FaqAdminService } from "./faq-admin.service";
import { UpdateFaqItemDto } from "./dto/update-faq-item.dto";

/**
 * Quản trị FAQ cho chat CSKH. Chỉ manager/admin — staff không được sửa nội
 * dung shop tự động trả lời.
 */
@Controller("chat/faq")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("manager_owner", "admin")
export class FaqAdminController {
  constructor(private readonly faqAdminService: FaqAdminService) {}

  @Get()
  async list() {
    return ok(await this.faqAdminService.list());
  }

  @Put(":key")
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("key") key: string,
    @Body() dto: UpdateFaqItemDto,
  ) {
    return ok(await this.faqAdminService.update(key, user, dto));
  }
}
