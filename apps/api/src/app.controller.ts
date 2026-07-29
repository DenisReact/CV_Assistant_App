import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health(): Promise<{ status: string; uptime: number }> {
    await this.prisma.$queryRaw`SELECT 1`;

    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
