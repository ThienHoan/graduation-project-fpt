import { IsDateString, Matches } from "class-validator";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SizeAvailabilityCalendarDto {
  @Matches(UUID_REGEX, { message: "garmentSizeId must be a UUID" })
  garmentSizeId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;
}
