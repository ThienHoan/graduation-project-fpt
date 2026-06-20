import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class CreateBookingDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  garmentSizeIds!: string[];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  pickupMethod?: string;

  @IsOptional()
  @IsUUID("4")
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
  @IsIn(["cash", "qr_code"])
  paymentMethod?: string;
}
