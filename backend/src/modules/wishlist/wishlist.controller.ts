import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { WishlistService } from "./wishlist.service";
import { SyncWishlistDto } from "./dto/sync-wishlist.dto";

@Controller("wishlist")
@UseGuards(JwtAuthGuard)
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.wishlistService.findUserWishlist(user.id);
  }

  @Post("sync")
  sync(@CurrentUser() user: AuthenticatedUser, @Body() body: SyncWishlistDto) {
    return this.wishlistService.syncWishlist(user.id, body.garmentIds ?? []);
  }

  @Post(":garmentId")
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param("garmentId", ParseUUIDPipe) garmentId: string,
  ) {
    return this.wishlistService.addToWishlist(user.id, garmentId);
  }

  @Delete(":garmentId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("garmentId", ParseUUIDPipe) garmentId: string,
  ) {
    return this.wishlistService.removeFromWishlist(user.id, garmentId);
  }
}
