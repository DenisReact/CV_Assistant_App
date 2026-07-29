import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import type { AuthenticatedRequest } from './current-user';

export const USER_EMAIL_HEADER = 'x-user-email';

@Injectable()
export class UserContextGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers[USER_EMAIL_HEADER];

    const email = typeof header === 'string' ? header.trim() : undefined;

    if (!email) {
      throw new UnauthorizedException(`Missing ${USER_EMAIL_HEADER} header`);
    }

    const user = await this.users.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Unknown user; sign in first');
    }

    request.user = { id: user.id, email: user.email };

    return true;
  }
}
