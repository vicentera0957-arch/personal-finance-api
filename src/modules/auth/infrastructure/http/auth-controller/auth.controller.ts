import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RegisterUseCase } from '../../../application/use-cases/register.use-case';
import { RefreshTokenUseCase } from '../../../application/use-cases/refresh-token.use-case';
import { LogoutUseCase } from '../../../application/use-cases/logout.use-case';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { LogoutDto } from '../dto/logout.dto';
import { Public } from '../../decorators/public.decorator';
import {
  UserAlreadyExistsException,
  UserNotFoundException,
} from '../../../../users/domain/exceptions/user.exceptions';
import {
  InvalidCredentialsException,
  InvalidRefreshTokenException,
  RefreshTokenExpiredException,
  RefreshTokenReplayDetectedException,
} from '../../../domain/exceptions/auth.exceptions';

// Límite estricto SOLO para /auth/*: sobreescribe el bucket global 'default'
// en este controller (5 req/min por IP por ruta). Impide fuerza bruta contra
// login, spam de registros y abuso de refresh.
// OJO: se sobreescribe 'default'; NO registrar un throttler 'auth' aparte en
// app.module — ThrottlerGuard corre CADA throttler registrado sobre CADA ruta,
// y un bucket con nombre de 5/min terminaba limitando toda la API (bug real:
// 429 en POST /categories durante el seed de demo).
// Límite/ttl configurables por env (THROTTLE_AUTH_LIMIT / THROTTLE_AUTH_TTL);
// fallback a 5/60s.
@ApiTags('auth')
@Throttle({
  default: {
    limit: Number(process.env.THROTTLE_AUTH_LIMIT ?? 5),
    ttl: Number(process.env.THROTTLE_AUTH_TTL ?? 60_000),
  },
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly registerUseCase: RegisterUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar sesión → devuelve access + refresh token' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Tokens emitidos' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
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
  @ApiOperation({ summary: 'Registrar un nuevo usuario' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'Usuario creado' })
  @ApiResponse({ status: 409, description: 'Email ya registrado' })
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
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotar refresh token → nuevo par de tokens' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'Nuevo par de tokens' })
  @ApiResponse({
    status: 401,
    description: 'Refresh token inválido, expirado o replay detectado',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    try {
      return await this.refreshTokenUseCase.execute(dto.refreshToken);
    } catch (error) {
      if (
        error instanceof InvalidRefreshTokenException ||
        error instanceof RefreshTokenExpiredException ||
        error instanceof RefreshTokenReplayDetectedException
      ) {
        throw new UnauthorizedException('Refresh token inválido o expirado');
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revocar refresh token (cierre de sesión)' })
  @ApiBody({ type: LogoutDto })
  @ApiResponse({ status: 204, description: 'Sesión cerrada' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido' })
  async logout(@Body() dto: LogoutDto) {
    try {
      await this.logoutUseCase.execute(dto.refreshToken);
    } catch (error) {
      if (error instanceof InvalidRefreshTokenException) {
        throw new UnauthorizedException('Refresh token inválido');
      }
      throw error;
    }
  }
}
