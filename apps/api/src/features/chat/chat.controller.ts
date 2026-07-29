import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user';
import { UserContextGuard } from '../auth/user-context.guard';
import { ChatService, type MessageView } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('sessions/:id/messages')
@UseGuards(UserContextGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  async history(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<MessageView[]> {
    return this.chat.history(user.id, sessionId);
  }

  @Post()
  async send(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageView> {
    return this.chat.ask(user.id, sessionId, dto.content.trim());
  }
}
