import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from 'src/ai/llm/llm.module';
import { RetrievalModule } from 'src/rag/retrieval/retrieval.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, SessionsModule, RetrievalModule, LlmModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
