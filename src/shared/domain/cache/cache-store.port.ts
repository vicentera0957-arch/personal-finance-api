export abstract class ICacheStore {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract delByPrefix(prefix: string): Promise<void>;
  /**
   * Verifica conectividad con el backing store. Resuelve si responde, rechaza
   * si no. Lo usa la readiness probe para tratar Redis como dependencia dura.
   */
  abstract ping(): Promise<void>;
}
