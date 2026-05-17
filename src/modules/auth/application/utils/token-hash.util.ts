import { createHash } from 'crypto';

/** SHA-256 hex del token. Los tokens tienen alta entropía propia, sal no es necesaria. */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
