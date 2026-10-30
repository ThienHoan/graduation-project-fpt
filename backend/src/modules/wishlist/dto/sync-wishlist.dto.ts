import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";

export class SyncWishlistDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID("4", { each: true })
  garmentIds!: string[];
}
