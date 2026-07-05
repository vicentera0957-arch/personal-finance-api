import { monthPeriod } from './month-period';

describe('monthPeriod', () => {
  it('returns [first day of the month, first day of the next month)', () => {
    const { start, end } = monthPeriod(2026, 6);

    expect(start).toEqual(new Date(2026, 5, 1));
    expect(end).toEqual(new Date(2026, 6, 1));
  });

  it('rolls over into the next year for December', () => {
    const { start, end } = monthPeriod(2026, 12);

    expect(start).toEqual(new Date(2026, 11, 1));
    expect(end).toEqual(new Date(2027, 0, 1)); // enero del año siguiente
  });

  it('matches exactly the original inline semantics it replaces', () => {
    for (let month = 1; month <= 12; month++) {
      const { start, end } = monthPeriod(2026, month);

      // Igualdad literal con `new Date(year, month - 1, 1)` / `new Date(year, month, 1)`,
      // los dos cálculos que estaban duplicados en unit-of-work.impl.ts.
      expect(start).toEqual(new Date(2026, month - 1, 1));
      expect(end).toEqual(new Date(2026, month, 1));
    }
  });

  it('produces a start strictly before the end', () => {
    const { start, end } = monthPeriod(2026, 2);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});
