import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/infrastructure/config/env.js';

const validEnv = {
  MONGODB_URI: 'mongodb://localhost:27017/bitacora',
  REDIS_QUEUE_URL: 'redis://localhost:6379/0',
  REDIS_CACHE_URL: 'redis://localhost:6379/1',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ISSUER: 'bitacora-api',
  JWT_AUDIENCE: 'bitacora-clients',
} satisfies NodeJS.ProcessEnv;

const withEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...validEnv,
  ...overrides,
});

function catchEnvError(source: NodeJS.ProcessEnv): EnvValidationError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected loadEnv to throw');
}

describe('loadEnv', () => {
  describe('entorno válido', () => {
    it('devuelve la configuración tipada con valores explícitos', () => {
      const env = loadEnv(
        withEnv({
          NODE_ENV: 'production',
          RUN_MODE: 'worker',
          PORT: '8080',
          LOG_LEVEL: 'warn',
          TRUST_PROXY: '1',
          CORS_ORIGINS: 'http://localhost:5173, https://app.example.com/',
          MONGODB_TEST_URI: 'mongodb://localhost:27017/bitacora_test',
          QUEUE_PREFIX: 'bita-test',
          ACCESS_TOKEN_TTL_SECONDS: '600',
          REFRESH_TOKEN_TTL_DAYS: '5',
          REFRESH_ABSOLUTE_TTL_DAYS: '20',
          COOKIE_SECURE: 'true',
        }),
      );

      expect(env).toMatchObject({
        NODE_ENV: 'production',
        RUN_MODE: 'worker',
        PORT: 8080,
        LOG_LEVEL: 'warn',
        TRUST_PROXY: 1,
        CORS_ORIGINS: ['http://localhost:5173', 'https://app.example.com'],
        MONGODB_TEST_URI: 'mongodb://localhost:27017/bitacora_test',
        QUEUE_PREFIX: 'bita-test',
        ACCESS_TOKEN_TTL_SECONDS: 600,
        REFRESH_TOKEN_TTL_DAYS: 5,
        REFRESH_ABSOLUTE_TTL_DAYS: 20,
        COOKIE_SECURE: true,
      });
    });

    it('devuelve un objeto congelado (también la lista de orígenes)', () => {
      const env = loadEnv(withEnv({ CORS_ORIGINS: 'http://localhost:5173' }));

      expect(Object.isFrozen(env)).toBe(true);
      expect(Object.isFrozen(env.CORS_ORIGINS)).toBe(true);
    });

    it('ignora variables desconocidas y no las propaga', () => {
      const env = loadEnv(withEnv({ PATH: '/usr/bin', SOMETHING_ELSE: 'x' }));

      expect(env).not.toHaveProperty('PATH');
      expect(env).not.toHaveProperty('SOMETHING_ELSE');
    });
  });

  describe('defaults', () => {
    it('aplica los valores por defecto cuando solo están las obligatorias', () => {
      const env = loadEnv(withEnv());

      expect(env).toMatchObject({
        NODE_ENV: 'development',
        RUN_MODE: 'all',
        PORT: 3000,
        LOG_LEVEL: 'info',
        TRUST_PROXY: 0,
        CORS_ORIGINS: [],
        QUEUE_PREFIX: 'bitacora',
        ACCESS_TOKEN_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_DAYS: 7,
        REFRESH_ABSOLUTE_TTL_DAYS: 30,
        COOKIE_SECURE: false,
      });
      expect(env.MONGODB_TEST_URI).toBeUndefined();
    });

    it('COOKIE_SECURE es true por defecto solo en production', () => {
      expect(loadEnv(withEnv({ NODE_ENV: 'production' })).COOKIE_SECURE).toBe(true);
      expect(loadEnv(withEnv({ NODE_ENV: 'test' })).COOKIE_SECURE).toBe(false);
    });

    it('interpreta COOKIE_SECURE="false" como false (no como string truthy)', () => {
      expect(loadEnv(withEnv({ COOKIE_SECURE: 'false' })).COOKIE_SECURE).toBe(false);
    });
  });

  describe('entorno inválido', () => {
    it('lista TODAS las variables obligatorias que faltan de una sola vez', () => {
      const error = catchEnvError({});
      const variables = error.issues.map((issue) => issue.variable);

      expect(variables).toEqual(
        expect.arrayContaining([
          'MONGODB_URI',
          'REDIS_QUEUE_URL',
          'REDIS_CACHE_URL',
          'JWT_ACCESS_SECRET',
          'JWT_ISSUER',
          'JWT_AUDIENCE',
        ]),
      );
      expect(error.message).toContain('MONGODB_URI: is required');
    });

    it('reporta varios valores inválidos a la vez', () => {
      const error = catchEnvError(
        withEnv({
          PORT: 'abc',
          RUN_MODE: 'cluster',
          REDIS_QUEUE_URL: 'http://x',
          TRUST_PROXY: '-1',
        }),
      );

      expect(error.issues.map((issue) => issue.variable).sort()).toEqual([
        'PORT',
        'REDIS_QUEUE_URL',
        'RUN_MODE',
        'TRUST_PROXY',
      ]);
    });

    it.each([
      ['PORT', '0'],
      ['PORT', '70000'],
      ['PORT', '3000.5'],
      ['COOKIE_SECURE', 'yes'],
      ['LOG_LEVEL', 'verbose'],
      ['CORS_ORIGINS', '*'],
      ['CORS_ORIGINS', 'ftp://example.com'],
      ['QUEUE_PREFIX', 'bad prefix!'],
      ['ACCESS_TOKEN_TTL_SECONDS', '5'],
    ])('rechaza %s=%s', (variable, value) => {
      const error = catchEnvError(withEnv({ [variable]: value }));

      expect(error.issues.map((issue) => issue.variable)).toContain(variable);
    });

    it('exige JWT_ACCESS_SECRET de al menos 32 caracteres', () => {
      const error = catchEnvError(withEnv({ JWT_ACCESS_SECRET: 'x'.repeat(31) }));

      expect(error.issues).toEqual([
        { variable: 'JWT_ACCESS_SECRET', message: 'must be at least 32 characters' },
      ]);
    });

    it('NO imprime los valores de secretos ni credenciales en el mensaje', () => {
      const secret = 'super-secret-value';
      const password = 'p4ssw0rd-in-uri';
      const error = catchEnvError(
        withEnv({
          JWT_ACCESS_SECRET: secret,
          MONGODB_URI: `http://admin:${password}@db.example.com`,
        }),
      );

      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain(password);
      expect(JSON.stringify(error.issues)).not.toContain(secret);
      expect(JSON.stringify(error.issues)).not.toContain(password);
    });
  });

  describe('reglas entre variables', () => {
    it('rechaza COOKIE_SECURE=false en production', () => {
      const error = catchEnvError(withEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }));

      expect(error.issues).toEqual([
        { variable: 'COOKIE_SECURE', message: 'must be true when NODE_ENV=production' },
      ]);
    });

    it('rechaza un tope absoluto de refresh menor que el TTL del refresh', () => {
      const error = catchEnvError(
        withEnv({ REFRESH_TOKEN_TTL_DAYS: '10', REFRESH_ABSOLUTE_TTL_DAYS: '5' }),
      );

      expect(error.issues.map((issue) => issue.variable)).toEqual(['REFRESH_ABSOLUTE_TTL_DAYS']);
    });

    it('rechaza que MONGODB_TEST_URI sea igual a MONGODB_URI', () => {
      const error = catchEnvError(withEnv({ MONGODB_TEST_URI: validEnv.MONGODB_URI }));

      expect(error.issues.map((issue) => issue.variable)).toEqual(['MONGODB_TEST_URI']);
    });
  });

  it('es pura: no depende de process.env', () => {
    const before = { ...process.env };

    loadEnv(withEnv({ PORT: '4321' }));

    expect(process.env).toEqual(before);
  });
});
