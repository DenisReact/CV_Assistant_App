import { Module } from '@nestjs/common';
import { GeminiLlmService } from './gemini-llm.service';
import { LlmService } from './llm.service';

@Module({
  providers: [{ provide: LlmService, useClass: GeminiLlmService }],
  exports: [LlmService],
})
export class LlmModule {}
