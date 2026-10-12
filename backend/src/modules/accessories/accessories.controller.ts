import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AccessoriesService } from "./accessories.service";
import { CreateAccessoryDto } from "./dto/create-accessory.dto";
import { UpdateAccessoryDto } from "./dto/update-accessory.dto";
import { CreateAccessoryAssetDto } from "./dto/create-accessory-asset.dto";
import { UpdateAccessoryAssetStatusDto } from "./dto/update-accessory-asset-status.dto";

@Controller("accessories")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("staff", "manager_owner", "admin")
export class AccessoriesController {
  constructor(private readonly accessoriesService: AccessoriesService) {}

  @Get()
  findAll(@Query("includeInactive") includeInactive?: string) {
    return this.accessoriesService.findAll(includeInactive === "true");
  }

  /**
   * Phụ kiện cần xử lý sau kiểm tra trả đồ (giặt / sửa / hỏng / mất).
   * Dùng cho tab Giặt sấy và tab Hư hỏng của manager.
   * Đặt TRƯỚC các route ":id..." vì Express khớp theo thứ tự khai báo —
   * nếu để sau, "processing/assets" sẽ bị ":id/assets" nuốt (id = "processing").
   */
  @Get("processing/assets")
  findProcessingAssets() {
    return this.accessoriesService.findProcessingAssets();
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.accessoriesService.findOne(id);
  }

  @Post()
  @Roles("manager_owner", "admin")
  create(@Body() dto: CreateAccessoryDto) {
    return this.accessoriesService.create(dto);
  }

  @Patch(":id")
  @Roles("manager_owner", "admin")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAccessoryDto) {
    return this.accessoriesService.update(id, dto);
  }

  @Get(":id/assets")
  findAssetsByAccessory(@Param("id", ParseUUIDPipe) id: string) {
    return this.accessoriesService.findAssetsByAccessory(id);
  }

  @Get(":id/garments")
  findLinkedGarments(@Param("id", ParseUUIDPipe) id: string) {
    return this.accessoriesService.findLinkedGarments(id);
  }

  @Post("assets")
  @Roles("manager_owner", "admin")
  createAsset(
    @Body() dto: CreateAccessoryAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accessoriesService.createAsset(dto, user.id);
  }

  @Patch("assets/:id/status")
  @Roles("manager_owner", "admin")
  updateAssetStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessoryAssetStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accessoriesService.updateAssetStatus(id, dto, user.id);
  }

  @Get("assets/:id/history")
  findAssetHistory(@Param("id", ParseUUIDPipe) id: string) {
    return this.accessoriesService.findAssetHistory(id);
  }
}
