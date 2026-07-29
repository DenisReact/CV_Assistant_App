import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { User } from 'src/generated/prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findOrCreate(email: string): Promise<User> {
    const normalised = this.normalise(email);

    return this.prisma.user.upsert({
      where: { email: normalised },
      update: {},
      create: { email: normalised },
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: this.normalise(email) },
    });
  }

  private normalise(email: string): string {
    return email.trim().toLowerCase();
  }
}
