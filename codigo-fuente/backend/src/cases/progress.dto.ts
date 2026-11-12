import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import { ArchiveCaseDto } from "./case.dto";
export const PROGRESS_STAGES = [
  "ASSESSMENT",
  "PREPARATION",
  "IN_PROGRESS",
  "FOLLOW_UP",
  "COMPLETED",
];
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class ProgressDto extends ArchiveCaseDto {
  @IsIn(PROGRESS_STAGES) stage!: string;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(2000) summary!: string;
  @Transform(trim) @IsString() @MaxLength(1000) nextAction!: string;
}
