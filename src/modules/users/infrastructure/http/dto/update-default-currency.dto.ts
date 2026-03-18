import { IsEnum, IsNotEmpty } from 'class-validator';

export enum Currency {
  USD = 'USD',
}

export class UpdateDefaultCurrencyDto {
  @IsEnum(Currency)
  @IsNotEmpty()
  currency: Currency;
}
