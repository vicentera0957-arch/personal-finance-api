\echo '======== B3.LIMPIEZA - borrar todo lo que creo el bloque 3 ========'

DELETE FROM transactions WHERE description LIKE 'lab-b3%';
DELETE FROM budgets  WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
DELETE FROM accounts WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                                  'aaaaaaaa-0000-0000-0000-000000000002');

\echo '-------- verificacion: no debe quedar nada --------'
SELECT count(*) AS transacciones_lab FROM transactions WHERE description LIKE 'lab-b3%';
SELECT count(*) AS presupuestos_lab  FROM budgets  WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
SELECT count(*) AS cuentas_lab       FROM accounts WHERE id LIKE 'aaaaaaaa-0000-0000-0000-%';

SELECT count(*) AS filas_totales FROM transactions;
ANALYZE transactions;
