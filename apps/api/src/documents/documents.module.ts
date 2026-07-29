import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ChunksRepository } from './chunks.repository';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [AuthModule, IngestionModule, EmbeddingsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ChunksRepository],
  exports: [DocumentsService, ChunksRepository],
})
export class DocumentsModule {}
