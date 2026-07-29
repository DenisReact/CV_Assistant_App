import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, type RequestUser } from '../auth/current-user';
import { UserContextGuard } from '../auth/user-context.guard';
import {
  FitService,
  type FitAnalysisView,
  type SessionFitView,
} from './fit.service';

export class AnalyseSessionDto {
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class AnalysePairDto {
  @IsUUID()
  resumeId!: string;

  @IsUUID()
  jobId!: string;

  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

@Controller()
@UseGuards(UserContextGuard)
export class FitController {
  constructor(private readonly fit: FitService) {}

  @Get('sessions/:id/fit')
  async sessionFit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<SessionFitView> {
    return this.fit.sessionFit(user.id, sessionId);
  }

  @Post('sessions/:id/fit')
  async analyseSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: AnalyseSessionDto,
  ): Promise<SessionFitView> {
    return this.fit.analyseSession(user.id, sessionId, dto.refresh ?? false);
  }

  @Post('fit')
  async analysePair(
    @CurrentUser() user: RequestUser,
    @Body() dto: AnalysePairDto,
  ): Promise<FitAnalysisView> {
    return this.fit.analyse(
      user.id,
      dto.resumeId,
      dto.jobId,
      dto.refresh ?? false,
    );
  }
}
