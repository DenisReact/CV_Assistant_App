import { Module } from '@nestjs/common';
import { ChunkingService } from './chunking.service';
import { DocumentClassifierService } from './document-classifier.service';
import { TextExtractionService } from './text-extraction.service';

/**
 * The write half of the RAG pipeline: file in, embeddable chunks out.
 *
 * All three services are pure transforms over text with no database or provider
 * dependencies of their own. Orchestration and persistence live in
 * DocumentsService, which is what lets these be unit-tested as plain functions
 * and reused from a background worker later without dragging a module graph
 * along.
 */
@Module({
  providers: [
    TextExtractionService,
    ChunkingService,
    DocumentClassifierService,
  ],
  exports: [TextExtractionService, ChunkingService, DocumentClassifierService],
})
export class IngestionModule {}
