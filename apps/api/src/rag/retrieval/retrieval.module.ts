import { Module } from '@nestjs/common';
import { DocumentsModule } from 'src/features/documents/documents.module';
import { EmbeddingsModule } from 'src/ai/embeddings/embeddings.module';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [DocumentsModule, EmbeddingsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
