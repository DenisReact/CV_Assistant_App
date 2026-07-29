import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CurrentUser, type RequestUser } from './current-user';
import { LoginDto } from './dto/login.dto';
import { UserContextGuard } from './user-context.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto): Promise<RequestUser> {
    const user = await this.users.findOrCreate(dto.email);

    return { id: user.id, email: user.email };
  }

  @Get('me')
  @UseGuards(UserContextGuard)
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }
}
