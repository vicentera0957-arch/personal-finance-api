/**
 * Aggregate root que representa una sesión de refresh token en DB.
 *
 * Invariantes:
 *  - Una vez revocado (revokedAt != null) no puede volver a usarse.
 *  - replacedById apunta al id del token que lo reemplazó (rotación normal)
 *    o es null (logout / revocación de familia).
 */
export class RefreshToken {
  private constructor(
    private readonly _id: string,
    private readonly _userId: string,
    private readonly _familyId: string,
    private readonly _tokenHash: string,
    private readonly _expiresAt: Date,
    private readonly _createdAt: Date,
    private _revokedAt: Date | null,
    private _replacedById: string | null,
  ) {}

  static create(props: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): RefreshToken {
    return new RefreshToken(
      props.id,
      props.userId,
      props.familyId,
      props.tokenHash,
      props.expiresAt,
      new Date(),
      null,
      null,
    );
  }

  static reconstitute(props: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    revokedAt: Date | null;
    replacedById: string | null;
  }): RefreshToken {
    return new RefreshToken(
      props.id,
      props.userId,
      props.familyId,
      props.tokenHash,
      props.expiresAt,
      props.createdAt,
      props.revokedAt,
      props.replacedById,
    );
  }

  revoke(replacedById?: string): void {
    this._revokedAt = new Date();
    this._replacedById = replacedById ?? null;
  }

  isRevoked(): boolean {
    return this._revokedAt !== null;
  }

  isExpired(): boolean {
    return this._expiresAt < new Date();
  }

  isUsable(): boolean {
    return !this.isRevoked() && !this.isExpired();
  }

  get id(): string { return this._id; }
  get userId(): string { return this._userId; }
  get familyId(): string { return this._familyId; }
  get tokenHash(): string { return this._tokenHash; }
  get expiresAt(): Date { return this._expiresAt; }
  get createdAt(): Date { return this._createdAt; }
  get revokedAt(): Date | null { return this._revokedAt; }
  get replacedById(): string | null { return this._replacedById; }
}
