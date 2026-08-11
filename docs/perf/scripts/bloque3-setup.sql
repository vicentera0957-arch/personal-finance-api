\echo '======== B3.SETUP - CUENTAS Y PRESUPUESTO DE LABORATORIO ========'

DELETE FROM transactions WHERE description LIKE 'lab-b3%';
DELETE FROM budgets  WHERE id IN ('bbbbbbbb-0000-0000-0000-000000000001');
DELETE FROM accounts WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                                  'aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO accounts (id, user_id, name, type, initial_balance, current_balance, is_archived, created_at, updated_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
        '7afba7e7-5856-4bd5-8cce-57887f4b1947',
        'LAB B3 - cuenta A', 'corriente', 100000, 100000, false, now(), now()),
       ('aaaaaaaa-0000-0000-0000-000000000002',
        '7afba7e7-5856-4bd5-8cce-57887f4b1947',
        'LAB B3 - cuenta B', 'corriente', 100000, 100000, false, now(), now());

INSERT INTO budgets (id, user_id, category_id, month, year, amount_limit, created_at, updated_at)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
        '7afba7e7-5856-4bd5-8cce-57887f4b1947',
        '98de0404-ead4-4c77-9cb3-5875f282a936',
        9, 2026, 100000, now(), now());

\echo '-------- cuentas --------'
SELECT id, name, current_balance FROM accounts
WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000002');

\echo '-------- presupuesto (septiembre 2026, limite 100.000, gasto 0) --------'
SELECT b.id, b.month, b.year, b.amount_limit,
       COALESCE((SELECT sum(amount) FROM v_period_expenses e
                 WHERE e.user_id = b.user_id AND e.category_id = b.category_id
                   AND e.transaction_date >= '2026-09-01'
                   AND e.transaction_date <  '2026-10-01'), 0) AS gastado
FROM budgets b WHERE b.id = 'bbbbbbbb-0000-0000-0000-000000000001';

\echo '-------- parametros de sesion relevantes --------'
SHOW default_transaction_isolation;
SHOW deadlock_timeout;
SHOW lock_timeout;
