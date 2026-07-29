import { Module } from '@nestjs/common';
import { ChunkingService } from './chunking.service';
import { TextExtractionService } from './text-extraction.service';

@Module({
  providers: [TextExtractionService, ChunkingService],
  exports: [TextExtractionService, ChunkingService],
})
export class IngestionModule {}
