#!/bin/sh
# Release phase: aplica migraciones pendientes ANTES de levantar la app.
# Si las migraciones fallan, el contenedor NO arranca (set -e) — preferible a
# correr la app nueva contra un schema viejo.
#
# Saltable con RUN_MIGRATIONS=false (útil si las migraciones las corre un Job
# separado en Kubernetes en vez del propio contenedor de la app).
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Aplicando migraciones..."
  node ./node_modules/typeorm/cli.js -d dist/data-source.js migration:run
  echo "[entrypoint] Migraciones OK."
else
  echo "[entrypoint] RUN_MIGRATIONS=false — se omiten migraciones."
fi

echo "[entrypoint] Iniciando aplicación..."
exec "$@"
