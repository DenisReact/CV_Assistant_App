import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, type RequestUser } from '../auth/current-user';
import { UserContextGuard } from '../auth/user-context.guard';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentKind } from '../generated/prisma/enums';
import type { Document } from '../generated/prisma/client';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The response shape; `rawText` is excluded because it is megabytes the UI never renders. */
export interface DocumentView {
  id: string;
  kind: DocumentKind;
  title: string;
  status: string;
  chunkCount: number;
  sourceFilename: string | null;
  byteSize: number | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Controller('documents')
@UseGuards(UserContextGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ): Promise<DocumentView> {
    if (!file) {
      throw new BadRequestException(
        'A file is required under the "file" field',
      );
    }

    const document = await this.documents.upload(
      user.id,
      file,
      dto.kind,
      dto.title,
    );

    return this.toView(document);
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('kind') kind?: string,
  ): Promise<DocumentView[]> {
    const documents = await this.documents.list(user.id, this.parseKind(kind));

    return documents.map((document) => this.toView(document));
  }

  @Get(':id')
  async get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentView> {
    return this.toView(await this.documents.get(user.id, id));
  }

  @Post(':id/reprocess')
  @HttpCode(202)
  async reprocess(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentView> {
    return this.toView(await this.documents.reprocess(user.id, id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.documents.remove(user.id, id);
  }

  private parseKind(kind?: string): DocumentKind | undefined {
    if (!kind) {
      return undefined;
    }

    if (!Object.values(DocumentKind).includes(kind as DocumentKind)) {
      throw new BadRequestException(
        `kind must be one of: ${Object.values(DocumentKind).join(', ')}`,
      );
    }

    return kind as DocumentKind;
  }

  private toView(document: Document): DocumentView {
    return {
      id: document.id,
      kind: document.kind,
      title: document.title,
      status: document.status,
      chunkCount: document.chunkCount,
      sourceFilename: document.sourceFilename,
      byteSize: document.byteSize,
      error: document.error,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
