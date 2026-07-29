import { Module } from '@nestjs/common';
import { DocumentsModule } from 'src/features/documents/documents.module';
import { EmbeddingsModule } from 'src/ai/embeddings/embeddings.module';
import { RetrievalService } from './retrieval.service';

/**
 * Wires retrieval to the two things it needs: the embeddings port to turn a
 * question into a vector, and the documents module for the chunk store it
 * searches.
 *
 * Importing DocumentsModule is the one place `rag/` reaches into `features/`,
 * because the chunk table is owned by the module that writes it. The
 * alternative — a second repository over the same table — would put the vector
 * literal format in two places.
 */
@Module({
  imports: [DocumentsModule, EmbeddingsModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
