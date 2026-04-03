import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/infrastructure/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER ?? 'finance_user',
      password: process.env.DB_PASSWORD ?? 'finance_password',
      database: process.env.DB_NAME ?? 'personal_finance_db',
      autoLoadEntities: true,
      synchronize: true, // solo dev — desactivar en producción
    }),
    AuthModule,
    UsersModule,
    AccountsModule,
    CategoriesModule,
    BudgetsModule,
    TransactionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global: todas las rutas requieren JWT salvo las marcadas @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
