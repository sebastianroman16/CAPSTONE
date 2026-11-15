import {
  IsIn,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  IsUUID,
  IsEmail,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class CaseFieldsDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
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

export class CreateCaseDto extends CaseFieldsDto {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160)
  newClientName?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254)
  newClientEmail?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  newClientPhone?: string;
}

export class UpdateCaseDto extends CaseFieldsDto {
  @IsUUID() clientId!: string;
  @IsInt() @Min(1) @Max(2147483646) version!: number;
}
export class ArchiveCaseDto {
  @IsInt() @Min(1) @Max(2147483646) version!: number;
}
