import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestUser {
  id: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: RequestUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new Error(
        'CurrentUser used on a route that is not protected by UserContextGuard',
      );
    }

    return request.user;
  },
);
