import { Module } from '@nestjs/common';
import { ReportsController } from './infrastructure/http/reports-controller/reports.controller';
import { GetPeriodSummaryUseCase } from './application/use-cases/get-period-summary.use-case';
import { IReportsReadStore } from './application/ports/reports-read-store.port';
import { ReportsReadStoreImpl } from './infrastructure/persistence/reports-read-store.impl';

/**
 * reports es un read model puro. No importa otros módulos ni registra entities:
 *   - No hay `TypeOrmModule.forFeature` porque no hay ORM entity (lee la view
 *     `v_period_expenses` por SQL crudo). `DataSource` ya es inyectable global
 *     (TypeOrmCoreModule es @Global).
 *   - No importa TransactionsModule: la dependencia sobre transactions es sólo
 *     a nivel de SCHEMA (la view lee su tabla), no de compilación. Cero
 *     acoplamiento de código entre módulos.
 *
 * Ver la sección "reports: read model sin capa domain" en CLAUDE.md.
 */
@Module({
  controllers: [ReportsController],
  providers: [
    GetPeriodSummaryUseCase,
    { provide: IReportsReadStore, useClass: ReportsReadStoreImpl },
  ],
})
export class ReportsModule {}
