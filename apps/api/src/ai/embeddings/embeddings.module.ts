import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { GeminiEmbeddingsService } from './gemini-embeddings.service';

/**
 * Binds the {@link EmbeddingsService} port to its current implementation.
 *
 * Unlike the LLM binding, changing this one is not free at runtime: vectors
 * already in `chunks` were produced by the old model, and similarity between
 * two different models' vectors is meaningless. Swapping the adapter is a
 * re-embed migration, which is why every chunk records the model that made it.
 */
@Module({
  providers: [
    { provide: EmbeddingsService, useClass: GeminiEmbeddingsService },
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
