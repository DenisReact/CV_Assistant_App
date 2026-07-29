import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user';
import { UserContextGuard } from '../auth/user-context.guard';
import {
  AddJobDto,
  CreateSessionDto,
  UpdateSessionDto,
} from './dto/session.dto';
import {
  SessionsService,
  type SessionView,
} from 'src/features/sessions/sessions.service';

@Controller('sessions')
@UseGuards(UserContextGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionView> {
    return this.sessions.create(user.id, dto);
  }

  @Get()
  async list(@CurrentUser() user: RequestUser): Promise<SessionView[]> {
    return this.sessions.list(user.id);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionView> {
    return this.sessions.get(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<SessionView> {
    return this.sessions.update(user.id, id, dto);
  }

  @Post(':id/jobs')
  async addJob(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddJobDto,
  ): Promise<SessionView> {
    return this.sessions.addJob(user.id, id, dto.documentId);
  }

  @Delete(':id/jobs/:documentId')
  async removeJob(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<SessionView> {
    return this.sessions.removeJob(user.id, id, documentId);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.sessions.remove(user.id, id);
  }
}
