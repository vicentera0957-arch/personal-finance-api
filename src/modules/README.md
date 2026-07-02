# Module notes

Each domain module keeps its design documentation **next to the code** (co-located),
not in `docs/`. The notes evolve with the module, so they live with it.

## Convention

| File | Purpose |
| --- | --- |
| `<module>/notes.md` | **Current state** — domain, use cases, infrastructure, wiring, gaps. |
| `<module>/notes-history.md` | **Closed post-mortems** — bugs/races already fixed, kept so the analysis isn't redone. |

A module has a `notes-history.md` only when it has closed post-mortems of its own.

## Index

| Module | Current | History |
| --- | --- | --- |
| [auth](./auth/notes.md) | yes | [post-mortems](./auth/notes-history.md) |
| [users](./users/notes.md) | yes | [post-mortems](./users/notes-history.md) |
| [accounts](./accounts/notes.md) | yes | — (Bug B post-mortem lives in [transactions](./transactions/notes-history.md)) |
| [categories](./categories/notes.md) | yes | — (no closed post-mortems) |
| [budgets](./budgets/notes.md) | yes | [post-mortems](./budgets/notes-history.md) |
| [transactions](./transactions/notes.md) | yes | [post-mortems](./transactions/notes-history.md) |

> Cross-module race post-mortems live centrally in
> [`docs/history/race-conditions-fix-2026-05.md`](../../docs/history/race-conditions-fix-2026-05.md).
> The current architecture overview (with diagrams) is
> [`docs/architecture.md`](../../docs/architecture.md).
