import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class UpdateRefundDetailsDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  bankName!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(64)
  bankAccountNumber!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  bankAccountHolder!: string;
}
