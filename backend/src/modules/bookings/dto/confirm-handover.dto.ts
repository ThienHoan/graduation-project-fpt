import {
  IsArray,
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";

export enum HandoverStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  REJECTED = "REJECTED",
}

export enum ConditionBeforeRental {
  GOOD = "GOOD",
  MINOR_DAMAGE = "MINOR_DAMAGE",
  MAJOR_DAMAGE = "MAJOR_DAMAGE",
}

export class ConfirmHandoverDto {
  @IsEnum(HandoverStatus)
  handoverStatus!: HandoverStatus;

  @IsEnum(ConditionBeforeRental)
  conditionBeforeRental!: ConditionBeforeRental;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @MaxLength(2048, { each: true })
  @IsUrl({ protocols: ["http", "https"], require_protocol: true }, { each: true })
  conditionImages?: string[];

  @IsOptional()
  @IsBoolean()
  correctProductConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  noDefectConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  customerAgreed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deliveredBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  receivedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  receiverPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}