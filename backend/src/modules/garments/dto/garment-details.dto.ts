import { IsNumber, IsOptional, Min } from "class-validator";

export class GarmentMeasurementsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  shoulderCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bustCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  waistCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hipCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lengthCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sleeveLengthCm?: number;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) seen.add(trimmed);
  }
  return [...seen];
}
