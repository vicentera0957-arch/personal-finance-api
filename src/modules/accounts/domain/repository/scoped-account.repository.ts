import { Account } from '../entities/account.entity';

// Command-side port: the account surface a NEIGHBOR module (transactions) or
// accounts' own UoW may use INSIDE an open transaction. It is never a DI
// token — the UoW's createContext() constructs the scoped implementation and
// hands it out as `ctx.accounts`.
//
// Deliberately narrower than `IAccountRepository`: no `findByUserId` (no
// caller ever needs it under lock) and no `delete` (DeleteAccount runs
// outside any UoW — it doesn't mutate the balance, so it doesn't need to
// serialize; see accounts/notes.md). A consumer that only reads/writes the
// account it locked can never delete a neighbor's aggregate by type.
export abstract class IScopedAccountRepository {
  abstract findByIdWithLock(id: string): Promise<Account | null>;
  abstract save(account: Account): Promise<Account>;
}
