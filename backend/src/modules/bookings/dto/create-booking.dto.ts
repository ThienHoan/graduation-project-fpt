import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { CANONICAL_UUID_REGEX } from "../../../common/validation/uuid-pattern";
import { BookingAccessorySelectionDto } from "./booking-accessory-selection.dto";

export class CreateBookingDto {
  @IsArray()
  @ArrayMinSize(1)
  @Matches(CANONICAL_UUID_REGEX, { each: true })
  garmentSizeIds!: string[];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsIn(["store_pickup", "delivery"])
  pickupMethod?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_REGEX)
  deliveryAddressId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  voucherCode?: string;

  @IsOptional()
  @IsString()
  @IsIn(["cash", "qr_code"])
  paymentMethod?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BookingAccessorySelectionDto)
  accessories?: BookingAccessorySelectionDto[];
}
