import { Controller, Get, Post, Patch, Delete, Param } from '@nestjs/common';

@Controller('users')
export class UserControllerController {
  @Get(':id')
  GetUserByIdUseCase(@Param('id') id: string) {
    return 'This action returns a user by ID';
  }

  @Post()
  CreateUserUseCase() {
    return 'This action creates a new user';
  }

  @Patch(':id')
  UpdateUserUseCase() {
    return 'This action updates a user';
  }

  @Delete(':id')
  DeleteUserUseCase() {
    return 'This action removes a user';
  }
}
