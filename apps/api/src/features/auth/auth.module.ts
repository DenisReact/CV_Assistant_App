import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { UserContextGuard } from './user-context.guard';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [UserContextGuard],
  exports: [UserContextGuard, UsersModule],
})
export class AuthModule {}
