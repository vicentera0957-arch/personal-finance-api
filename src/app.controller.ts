import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './modules/auth/infrastructure/decorators/public.decorator';

/**
 * - GET /        → root, puede servir como link a docs.
 * - GET /health  → liveness probe (público, sin prefix, sin JWT).
 *                  Docker/K8s/LB la llaman cada N segundos para saber si la
 *                  instancia está viva y puede seguir recibiendo tráfico.
 *                  Si responde !=200, el orquestador reinicia el contenedor.
 *
 * Gap conocido: falta /ready (readiness) que valide DB conectada, pool ok, etc.
 * Se puede añadir con @nestjs/terminus (TerminusModule + TypeOrmHealthIndicator).
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiTags('root')
  @ApiOperation({ summary: 'Raíz — apunta a /api/docs para ver la API.' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('/health')
  @ApiTags('health')
  @ApiOperation({ summary: 'Liveness probe — responde 200 si el proceso vive.' })
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
