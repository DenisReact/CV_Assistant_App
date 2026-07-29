import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const MAX_JOBS_PER_SESSION = 20;

export class CreateSessionDto {
  @IsOptional()
  @IsUUID()
  resumeId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_JOBS_PER_SESSION)
  @IsUUID(undefined, { each: true })
  jobIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class UpdateSessionDto {
  @IsOptional()
  @IsUUID()
  resumeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class AddJobDto {
  @IsUUID()
  documentId!: string;
}
