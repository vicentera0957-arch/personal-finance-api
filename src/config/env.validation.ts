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
  // En producción, host/user/password/name son REQUIRED — sin default.
  // Por qué: un default de dev (ej. 'finance_password') haría que un deploy
  // con la var olvidada arrancara silenciosamente con credenciales de juguete
  // en vez de fallar al arrancar. Fail-fast > fallback silencioso para secretos.
  // En dev/test conservan el default cómodo.
  DB_HOST: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('localhost'),
  }),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('finance_user'),
  }),
  DB_PASSWORD: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required().messages({
      'any.required':
        'DB_PASSWORD es required en producción — no se permite el default de dev.',
    }),
    otherwise: Joi.string().default('finance_password'),
  }),
  DB_NAME: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('personal_finance_db'),
  }),
  // synchronize debe estar SIEMPRE en false en production. En dev es true.
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  // TLS hacia la DB — los Postgres gestionados (Neon/Supabase/RDS) lo exigen.
  DB_SSL: Joi.boolean().default(false),
  // rejectUnauthorized=false solo si la DB usa certificado self-signed.
  DB_SSL_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  // Tamaño del pool de conexiones por instancia — evita agotar las conexiones del server.
  DB_POOL_MAX: Joi.number().default(10),
  DB_CONNECTION_TIMEOUT_MS: Joi.number().default(10_000),

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
  // En production se PROHÍBE '*': combinado con credentials:true es un riesgo
  // (refleja cualquier origen y permite credenciales cross-site).
  CORS_ORIGIN: Joi.string()
    .default('*')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().invalid('*').required().messages({
        'any.invalid':
          'CORS_ORIGIN no puede ser "*" en producción. Definí dominios explícitos separados por coma (ej: https://app.midominio.com).',
      }),
    }),

  // Nº de proxies de confianza delante de la app (LB / reverse proxy).
  // >0 hace que Express lea la IP real del cliente desde X-Forwarded-For,
  // crítico para que el rate-limit por IP del throttler funcione en prod.
  // Required en producción — mismo motivo que CORS_ORIGIN/DB_HOST: el default
  // (0) no hace crashear la app, pero rompe el rate-limit por IP en silencio
  // (todo el tráfico detrás del LB cae en un solo cubo — un usuario agota el
  // límite de todos). Forzamos que el operador lo declare a propósito. Si tu
  // prod de verdad no tiene proxy delante, seteá TRUST_PROXY=0 explícito.
  TRUST_PROXY: Joi.number()
    .default(0)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.number().required().messages({
        'any.required':
          'TRUST_PROXY es required en producción. Si tenés un LB/proxy delante (Railway, K8s Ingress, nginx), poné el nº de proxies (usualmente 1). Si no tenés ninguno, seteá TRUST_PROXY=0 explícitamente.',
      }),
    }),

  // Rate limiting (Throttler)
  // TTL en ms. LIMIT = max requests por IP durante ese TTL.
  THROTTLE_TTL: Joi.number().default(60_000), // 1 min
  THROTTLE_LIMIT: Joi.number().default(100),
  // Límite estricto para endpoints de auth (login/register/refresh)
  THROTTLE_AUTH_TTL: Joi.number().default(60_000),
  THROTTLE_AUTH_LIMIT: Joi.number().default(5),

  // Redis — cache y throttler storage. Host required en prod (mismo motivo
  // que la DB: evita que un deploy mal configurado apunte a localhost).
  REDIS_HOST: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('localhost'),
  }),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),
  REDIS_KEY_PREFIX: Joi.string().default('pf:'),

  // Swagger — se puede deshabilitar en prod si no quieres exponer el spec.
  SWAGGER_ENABLED: Joi.boolean().default(true),
});
