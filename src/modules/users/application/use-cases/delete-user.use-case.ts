import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface DeleteUserDto {
  id: string;
  requestUserId: string;
}
@Injectable()
export class DeleteUserUseCase {
  constructor(private readonly userRepository: IUserRepository) {}

  async execute(dto: DeleteUserDto): Promise<void> {
    if (dto.id !== dto.requestUserId) {
      throw new ResourceOwnershipException(dto.id);
    }
    const user = await this.userRepository.findById(dto.id);
    if (!user) {
      throw new UserNotFoundException(dto.id);
    }
    await this.userRepository.delete(dto.id);
  }
}
