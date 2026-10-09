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
import { CreateGarmentAccessoryDto } from "./dto/create-garment-accessory.dto";
import { UpdateGarmentAccessoryDto } from "./dto/update-garment-accessory.dto";
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

  @Get(":id/sizes")
  findSizesByGarment(@Param("id", ParseUUIDPipe) id: string) {
    return this.garmentsService.findSizesByGarment(id);
  }

  @Get(":id/accessories")
  findGarmentAccessories(@Param("id", ParseUUIDPipe) id: string) {
    return this.garmentsService.findGarmentAccessories(id);
  }

  @Post(":id/accessories")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  addGarmentAccessory(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateGarmentAccessoryDto,
  ) {
    return this.garmentsService.addGarmentAccessory(id, dto);
  }

  @Patch(":id/accessories/:accessoryId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  updateGarmentAccessory(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("accessoryId", ParseUUIDPipe) accessoryId: string,
    @Body() dto: UpdateGarmentAccessoryDto,
  ) {
    return this.garmentsService.updateGarmentAccessory(id, accessoryId, dto);
  }

  @Delete(":id/accessories/:accessoryId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  removeGarmentAccessory(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("accessoryId", ParseUUIDPipe) accessoryId: string,
  ) {
    return this.garmentsService.removeGarmentAccessory(id, accessoryId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) { return this.garmentsService.findOne(id); }

  @Get(":id/assets/available")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findAvailableAssets(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("garmentSizeId", new ParseUUIDPipe({ optional: true })) garmentSizeId?: string,
    @Query("bookingId", new ParseUUIDPipe({ optional: true })) bookingId?: string,
  ) {
    return this.garmentsService.findAvailableAssets(id, garmentSizeId, bookingId);
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
