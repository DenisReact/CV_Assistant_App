import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Every environment variable the API reads, validated once at bootstrap.
 *
 * The failure mode this buys out of: without it, a missing DATABASE_URL
 * surfaces as a Prisma stack trace at first query, and a typo'd PORT is
 * silently ignored. With it, the process refuses to start and the error names
 * every bad variable at once.
 */
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL!: string;

  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  /** Comma-separated list of allowed origins; absent means allow-all (dev). */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  /**
   * Deliberately optional: the API boots without it so sign-in and upload
   * validation stay testable, and the failure is raised at the point of use
   * with a message naming this variable. See EmbeddingsService / LlmService.
   */
  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  GEMINI_EMBEDDING_MODEL?: string;

  @IsOptional()
  @IsString()
  GEMINI_CHAT_MODEL?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    whitelist: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join('; '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validated;
}
