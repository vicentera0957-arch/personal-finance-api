import {
  Body,
  ConflictException,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RegisterUseCase } from '../../../application/use-cases/register.use-case';
import { RefreshTokenUseCase } from '../../../application/use-cases/refresh-token.use-case';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { Public } from '../../decorators/public.decorator';
import {
  UserAlreadyExistsException,
  UserNotFoundException,
} from '../../../../users/domain/exceptions/user.exceptions';
import { InvalidCredentialsException } from '../../../domain/exceptions/auth.exceptions';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly registerUseCase: RegisterUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    try {
      return await this.loginUseCase.execute(dto);
    } catch (error) {
      if (
        error instanceof UserNotFoundException ||
        error instanceof InvalidCredentialsException
      ) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      throw error;
    }
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    try {
      return await this.registerUseCase.execute(dto);
    } catch (error) {
      if (error instanceof UserAlreadyExistsException) {
        throw new ConflictException('El email ya está registrado');
      }
      throw error;
    }
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    try {
      return await this.refreshTokenUseCase.execute(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
  }
}
