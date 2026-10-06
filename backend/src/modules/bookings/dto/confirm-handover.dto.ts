import { IsArray, IsEnum, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

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
  @IsUrl({}, { each: true })
  conditionImages?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}