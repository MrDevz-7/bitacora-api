import { z } from 'zod';

/** Un problema de configuración. Nunca contiene el valor recibido (puede ser un secreto). */
export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
    super(`Invalid environment configuration (${issues.length} problem(s)):\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** String obligatorio con mensaje claro cuando falta. */
const required = () =>
  z.string({
    error: (issue) => (issue.input === undefined ? 'is required' : 'must be a string'),
  });

const integer = (min: number, max: number) =>
  z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(min, `must be >= ${min}`)
    .max(max, `must be <= ${max}`);

const MONGO_URI = /^mongodb(\+srv)?:\/\/.+/;
const REDIS_URL = /^rediss?:\/\/.+/;

function toHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** "http://a.com, https://b.com/" -> ["http://a.com", "https://b.com"] (inmutable). */
const originList = z
  .string()
  .default('')
  .transform((raw, ctx): readonly string[] => {
    const origins: string[] = [];
    for (const item of raw.split(',')) {
      const candidate = item.trim();
      if (candidate === '') continue;
      const origin = toHttpOrigin(candidate);
      if (origin === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a comma-separated list of http(s) origins',
        });
        return z.NEVER;
      }
      origins.push(origin);
    }
    return Object.freeze(origins);
  });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    RUN_MODE: z.enum(['api', 'worker', 'all']).default('all'),
    PORT: integer(1, 65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Nº de proxies de confianza (0 = ninguno). Nunca un booleano: "true" permite falsear la IP.
    TRUST_PROXY: integer(0, 10).default(0),
    CORS_ORIGINS: originList,

    MONGODB_URI: required().regex(MONGO_URI, 'must be a mongodb:// or mongodb+srv:// URI'),
    MONGODB_TEST_URI: z
      .string()
      .regex(MONGO_URI, 'must be a mongodb:// or mongodb+srv:// URI')
      .optional(),

    REDIS_QUEUE_URL: required().regex(REDIS_URL, 'must be a redis:// or rediss:// URL'),
    REDIS_CACHE_URL: required().regex(REDIS_URL, 'must be a redis:// or rediss:// URL'),
    QUEUE_PREFIX: z
      .string()
      .regex(/^[a-z0-9_-]+$/i, 'may only contain letters, digits, "_" and "-"')
      .default('bitacora'),

    JWT_ACCESS_SECRET: required().min(32, 'must be at least 32 characters'),
    JWT_ISSUER: required().min(1, 'must not be empty'),
    JWT_AUDIENCE: required().min(1, 'must not be empty'),
    ACCESS_TOKEN_TTL_SECONDS: integer(60, 86_400).default(900),
    REFRESH_TOKEN_TTL_DAYS: integer(1, 90).default(7),
    REFRESH_ABSOLUTE_TTL_DAYS: integer(1, 365).default(30),
    // Ojo: z.coerce.boolean("false") === true. Por eso se parsea el texto explícitamente.
    COOKIE_SECURE: z
      .enum(['true', 'false'], { error: 'must be "true" or "false"' })
      .transform((value) => value === 'true')
      .optional(),
  })
  .transform((env, ctx) => {
    const cookieSecure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';

    if (env.NODE_ENV === 'production' && !cookieSecure) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true when NODE_ENV=production',
      });
    }
    if (env.REFRESH_ABSOLUTE_TTL_DAYS < env.REFRESH_TOKEN_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_ABSOLUTE_TTL_DAYS'],
        message: 'must be >= REFRESH_TOKEN_TTL_DAYS',
      });
    }
    if (env.MONGODB_TEST_URI !== undefined && env.MONGODB_TEST_URI === env.MONGODB_URI) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_TEST_URI'],
        message: 'must differ from MONGODB_URI (tests would wipe the real database)',
      });
    }

    return { ...env, COOKIE_SECURE: cookieSecure };
  });

export type Env = Readonly<z.output<typeof EnvSchema>>;

/**
 * Función pura: valida `source` y devuelve la configuración tipada e inmutable.
 * No lee process.env; quien la llame (server.ts / worker.ts) decide qué fuente pasar.
 * Lanza EnvValidationError listando TODAS las variables inválidas, sin imprimir sus valores.
 */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? '(root)'),
        message: issue.message,
      })),
    );
  }
  return Object.freeze(result.data);
}
