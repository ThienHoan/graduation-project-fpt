import { IsDateString, IsInt, IsOptional, Matches, Max, Min } from "class-validator";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CheckAccessoryAvailabilityDto {
  @Matches(UUID_REGEX, { message: "accessoryId must be a UUID" })
  accessoryId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  /** Số đơn vị cần trong khoảng ngày (mặc định 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;
}
