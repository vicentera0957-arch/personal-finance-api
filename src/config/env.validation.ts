import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Database
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().default('finance_user'),
  DB_PASSWORD: Joi.string().default('finance_password'),
  DB_NAME: Joi.string().default('personal_finance_db'),

  // JWT — required, no defaults: the app must not start without these
  JWT_SECRET: Joi.string().required().messages({
    'any.required':
      "JWT_SECRET is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
  }),
  JWT_REFRESH_SECRET: Joi.string().required().messages({
    'any.required':
      "JWT_REFRESH_SECRET is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
  }),

  // App
  PORT: Joi.number().default(3000),
});
