import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';

import { AppModule } from './app.module';

/**
 * Bootstrap de la app — hardening de producción.
 *
 * Orden importa:
 *   1. Helmet ANTES que cualquier otra cosa para headers de seguridad (XSS, CSP, HSTS).
 *   2. CORS configurable por env para que el mismo build sirva dev y prod.
 *   3. ValidationPipe con whitelist → properties extra del body son rechazadas
 *      (evita mass-assignment / over-posting).
 *   4. Pino logger global reemplaza el ConsoleLogger default de Nest.
 *   5. Swagger SOLO si SWAGGER_ENABLED — en prod quizás prefieras no exponer el spec.
 *   6. enableShutdownHooks → Nest escucha SIGTERM/SIGINT y cierra DI graph limpio
 *      (cierra pool de Postgres, queries en curso, etc). Crítico para K8s/Docker.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // Pino como logger global
  app.useLogger(app.get(Logger));

  // Helmet: cabeceras HTTP de seguridad (X-Frame-Options, CSP, HSTS, etc)
  app.use(helmet());

  // CORS — lista de orígenes separados por coma, o '*' en dev
  const corsOrigin = config.getOrThrow<string>('CORS_ORIGIN');
  app.enableCors({
    origin:
      corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  });

  // Prefix para versionado implícito; el frontend sabe que todo va a /api/v1
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Validación global — whitelist strip props extra, forbidNonWhitelisted rechaza
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger / OpenAPI
  if (config.get<boolean>('SWAGGER_ENABLED')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Personal Finance API')
      .setDescription(
        'API DDD de finanzas personales — users, accounts, categories, budgets, transactions.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token — obtenido de POST /auth/login',
        },
        'access-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Cierre limpio en SIGTERM (Docker stop, K8s scale down)
  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
void bootstrap();
