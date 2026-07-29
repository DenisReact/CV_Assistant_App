import { Module } from '@nestjs/common';
import { GeminiLlmService } from './gemini-llm.service';
import { LlmService } from './llm.service';

/**
 * Binds the {@link LlmService} port to its current implementation. This one
 * line is the whole provider decision — swapping vendors means adding an
 * adapter beside {@link GeminiLlmService} and changing `useClass`, with no
 * feature or RAG code touched.
 *
 * Only the port is exported, so nothing downstream can inject the concrete
 * class and start depending on vendor specifics.
 */
@Module({
  providers: [{ provide: LlmService, useClass: GeminiLlmService }],
  exports: [LlmService],
})
export class LlmModule {}
