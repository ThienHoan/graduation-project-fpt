import { IsUUID } from "class-validator";

export class RedeemPointsDto {
  @IsUUID("4", { message: "ruleId phải là UUID hợp lệ" })
  ruleId!: string;
}
