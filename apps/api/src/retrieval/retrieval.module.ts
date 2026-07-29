import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [DocumentsModule, EmbeddingsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
