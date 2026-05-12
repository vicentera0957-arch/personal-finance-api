import * as Joi from 'joi';

/**
 * Validación de variables de entorno con Joi.
 * - El app NO arranca si falta una var `required()` o tiene formato inválido.
 * - `default(...)` provee valor por defecto — útil para dev, pero nunca para secrets.
 *
 * Por qué Joi y no process.env crudo:
 *   - Fallar rápido al arrancar > fallar en runtime al primer request.
 *   - Centraliza tipado + documentación del contrato de configuración.
 *   - Mensajes custom guían al dev a resolver (ej. cómo generar JWT_SECRET).
 */
export const envValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),

  // Database
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().default('finance_user'),
  DB_PASSWORD: Joi.string().default('finance_password'),
  DB_NAME: Joi.string().default('personal_finance_db'),
  // synchronize debe estar SIEMPRE en false en production. En dev es true.
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),

  // JWT — required, no defaults: el app debe fallar al arrancar si faltan
  JWT_SECRET: Joi.string().min(32).required().messages({
    'any.required':
      "JWT_SECRET is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    'string.min': 'JWT_SECRET must be at least 32 characters for security',
  }),
  JWT_REFRESH_SECRET: Joi.string().min(32).required().messages({
    'any.required':
      "JWT_REFRESH_SECRET is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
    'string.min':
      'JWT_REFRESH_SECRET must be at least 32 characters for security',
  }),
  // Formato ms-style (ej: '15m', '7d', '2h'). Lo entiende @nestjs/jwt directamente.
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // CORS — lista separada por comas. '*' en dev, dominios explícitos en prod.
  CORS_ORIGIN: Joi.string().default('*'),

  // Rate limiting (Throttler)
  // TTL en ms. LIMIT = max requests por IP durante ese TTL.
  THROTTLE_TTL: Joi.number().default(60_000), // 1 min
  THROTTLE_LIMIT: Joi.number().default(100),
  // Límite estricto para endpoints de auth (login/register/refresh)
  THROTTLE_AUTH_TTL: Joi.number().default(60_000),
  THROTTLE_AUTH_LIMIT: Joi.number().default(5),

  // Redis — cache y throttler storage
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),
  REDIS_KEY_PREFIX: Joi.string().default('pf:'),

  // Swagger — se puede deshabilitar en prod si no quieres exponer el spec.
  SWAGGER_ENABLED: Joi.boolean().default(true),
});
