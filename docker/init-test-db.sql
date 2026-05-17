-- Script de inicialización ejecutado por postgres en el primer arranque del contenedor.
-- Crea la base de datos separada para integration tests.
-- Los tests deben apuntar a personal_finance_db_test (ver test/.env.test).
CREATE DATABASE personal_finance_db_test;
GRANT ALL PRIVILEGES ON DATABASE personal_finance_db_test TO finance_user;
