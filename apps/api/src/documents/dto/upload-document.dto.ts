import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentKind } from '../../generated/prisma/enums';

export class UploadDocumentDto {
  @IsEnum(DocumentKind, {
    message: `kind must be one of: ${Object.values(DocumentKind).join(', ')}`,
  })
  kind!: DocumentKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
