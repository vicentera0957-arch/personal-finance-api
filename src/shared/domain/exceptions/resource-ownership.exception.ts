export class ResourceOwnershipException extends Error {
  constructor(resourceId: string) {
    super(`You do not have access to resource ${resourceId}`);
    this.name = 'ResourceOwnershipException';
  }
}
