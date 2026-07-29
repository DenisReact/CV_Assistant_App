import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './features/auth/auth.module';
import { ChatModule } from './features/chat/chat.module';
import { DocumentsModule } from './features/documents/documents.module';
import { EmbeddingsModule } from './ai/embeddings/embeddings.module';
import { FitModule } from './features/fit/fit.module';
import { IngestionModule } from './rag/ingestion/ingestion.module';
import { LlmModule } from './ai/llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { RetrievalModule } from './rag/retrieval/retrieval.module';
import { SessionsModule } from './features/sessions/sessions.module';
import { UsersModule } from './features/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    IngestionModule,
    EmbeddingsModule,
    DocumentsModule,
    LlmModule,
    RetrievalModule,
    SessionsModule,
    ChatModule,
    FitModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
