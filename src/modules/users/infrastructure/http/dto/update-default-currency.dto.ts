import { IsEnum, IsNotEmpty } from 'class-validator';

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  ARS = 'ARS',
  MXN = 'MXN',
}

export class UpdateDefaultCurrencyDto {
  @IsEnum(Currency)
  @IsNotEmpty()
  currency: Currency;
}
