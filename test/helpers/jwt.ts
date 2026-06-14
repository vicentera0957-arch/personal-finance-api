/**
 * Decodifica el claim `sub` (el userId) desde un access token JWT.
 *
 * `POST /auth/register` y `POST /auth/login` devuelven sólo `{ accessToken, refreshToken }`
 * — no exponen el id del usuario en el body. Pero el sistema lo lleva en el claim `sub`
 * del access token (ver `jwt.strategy.ts`: `validate(payload) → { userId: payload.sub }`).
 *
 * Los tests de integración necesitan ese id para construir las URLs `/users/:id`, así que
 * lo leemos del token. NO verifica la firma (no es el objetivo del helper): sólo extrae el
 * payload, que es exactamente el id que el guard real usará como `@CurrentUser().userId`.
 */
export function decodeJwtSub(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as { sub: string };
  return decoded.sub;
}
