import { IsUUID } from "class-validator";

export class CreatePaymentLinkDto {
  @IsUUID()
  bookingId!: string;
}
