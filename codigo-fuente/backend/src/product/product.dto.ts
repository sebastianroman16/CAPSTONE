import { Transform, Type } from "class-transformer";
import {
  IsInt,
  IsISO8601,
  Max,
  Min,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { MOVEMENT_TYPES } from "./ingestion-rules";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class NotificationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsISO8601({ strict: true }) before?: string;
  @IsOptional() @IsUUID() beforeId?: string;
}
export class DeadlineDto {
  @IsIn(["HEARING", "FILING", "MEETING", "REMINDER", "OTHER"])
  deadlineType!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
  @IsDateString() dueAt!: string;
  @IsOptional() @IsDateString() reminderAt?: string;
  @IsOptional() @IsIn(["Alta", "Media", "Baja"]) urgency?: string;
}
export class DeadlineStatusDto {
  @IsIn(["PENDING", "COMPLETED", "CANCELLED"]) status!: string;
}
export class CommunicationDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) message!: string;
  @IsIn(["IN_APP", "EMAIL", "WHATSAPP"]) channel!: string;
}
export class DocumentRequestDto {
  @IsUUID() assignedTo!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(250) title!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}
export class DocumentMetadataDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(250) title!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
  @IsIn(["PLEADING", "EVIDENCE", "CONTRACT", "COURT_RESOLUTION", "IDENTITY", "OTHER"])
  category!: string;
  @IsIn(["INTERNAL", "CLIENT"]) visibility!: string;
  @IsOptional() @IsUUID() requestId?: string;
}
export class IngestionTextDto {
  @IsIn(["EMAIL", "TEXT"]) sourceType!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(255) sourceName!: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(100000) text!: string;
  @IsOptional() @IsUUID() caseId?: string;
}
export class ReviewIngestionDto {
  @IsIn(["CONFIRMED", "REJECTED"]) status!: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(10) @MaxLength(2000)
  summary?: string;
  // CU-02: el abogado puede asociar la causa y corregir cada dato sugerido antes de publicar.
  @IsOptional() @IsUUID() caseId?: string;
  @IsOptional() @IsIn([...MOVEMENT_TYPES]) movementType?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) detectedDate?: string | null;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) detectedTime?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) court?: string | null;
}
export class IncomingEmailDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(255) messageId!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) lawyerEmail!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(255) subject!: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(100000) text!: string;
}
export class CreateClientDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) name!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
}
export class ProfileDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) name!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
}
