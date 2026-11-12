import {
  IsIn,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class SaveCaseDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsUUID() clientId!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) rit?: string;
  @IsIn(["Familia", "Laboral", "Civil", "Penal"]) matter!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) court!: string;
  @IsIn(["Alta", "Media", "Baja"]) priority!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) nextDate?: string | null;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  nextDateLabel?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  internalNotes?: string;
}

export class UpdateCaseDto extends SaveCaseDto {
  @IsInt() @Min(1) @Max(2147483646) version!: number;
}
export class ArchiveCaseDto {
  @IsInt() @Min(1) @Max(2147483646) version!: number;
}
