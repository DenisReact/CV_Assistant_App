import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from 'src/ai/llm/llm.module';
import { SessionsModule } from '../sessions/sessions.module';
import { FitController } from './fit.controller';
import { FitService } from './fit.service';

@Module({
  imports: [AuthModule, SessionsModule, LlmModule],
  controllers: [FitController],
  providers: [FitService],
})
export class FitModule {}
