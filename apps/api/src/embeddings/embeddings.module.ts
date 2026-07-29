import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { GeminiEmbeddingsService } from './gemini-embeddings.service';

@Module({
  providers: [
    { provide: EmbeddingsService, useClass: GeminiEmbeddingsService },
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
