import { IsObject } from "class-validator";

export class ImportMappingDto {
  @IsObject() mapping!: Record<string, unknown>;
}
