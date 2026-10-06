import {
  Body,
  Controller,
  Delete,
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
import { AddGarmentImageDto } from "./dto/add-image.dto";
import { CreateGarmentDto } from "./dto/create-garment.dto";
import { UpdateGarmentDto } from "./dto/update-garment.dto";
import { GarmentsService } from "./garments.service";

@Controller("garments")
export class GarmentsController {
  constructor(private readonly garmentsService: GarmentsService) {}

  // ── Public: Catalog ────────────────────────────────────────────────────────

  @Get()
  findAll() { return this.garmentsService.findAll(); }

  @Get("sizes")
  findAllSizes() {
    return this.garmentsService.findAllSizes();
  }

  @Get("grouped")
  findAllGrouped(
    @Query("search") search?: string,
    @Query("category") category?: string,
  ) { return this.garmentsService.findAllGrouped(search, category); }

  @Get("categories")
  findAllCategories() {
    return this.garmentsService.findAllCategories();
  }

  @Get(":id")
  findOne(@Param("id") id: string) { return this.garmentsService.findOne(id); }

  @Get(":id/assets/available")
  findAvailableAssets(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("garmentSizeId", new ParseUUIDPipe({ optional: true })) garmentSizeId?: string,
  ) {
    return this.garmentsService.findAvailableAssets(id, garmentSizeId);
  }

  // ── Manager / Owner: Garment CRUD ──────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  create(@Body() dto: CreateGarmentDto) {
    return this.garmentsService.create(dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateGarmentDto,
  ) {
    return this.garmentsService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.garmentsService.remove(id);
  }

  @Post(":id/images")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  addImage(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddGarmentImageDto,
  ) {
    return this.garmentsService.addImage(id, dto);
  }

  @Delete(":garmentId/images/:imageId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  removeImage(
    @Param("garmentId", ParseUUIDPipe) garmentId: string,
    @Param("imageId", ParseUUIDPipe) imageId: string,
  ) {
    return this.garmentsService.removeImage(garmentId, imageId);
  }

  @Post("sizes")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  createSize(@Body("sizeLabel") sizeLabel: string) {
    return this.garmentsService.createSize(sizeLabel);
  }

  @Post("categories")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  createCategory(
    @Body("name") name: string,
    @Body("description") description?: string,
  ) {
    return this.garmentsService.createCategory(name, description);
  }
}
