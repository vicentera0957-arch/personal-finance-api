# Borrador post LinkedIn (ES)

> Publicar como texto plano (LinkedIn no renderiza markdown). Reemplazar
> `[link al artículo]` y `[link al repo]` antes de publicar. Mejor horario:
> martes a jueves por la mañana. Los saltos de línea son intencionales —
> LinkedIn corta el post en "…ver más" alrededor de la línea 3: el gancho
> tiene que estar antes.

---

Mi API de finanzas personales podía crear plata de la nada.

No por un error de matemática — por timing. Todo el código era correcto cuando los requests llegaban de a uno. Varios flujos estaban rotos cuando llegaban dos al mismo tiempo.

Es mi primer proyecto backend (NestJS + PostgreSQL) y en vez de seguir agregando features, me detuve a hacerle a cada endpoint de escritura una sola pregunta: ¿qué pasa si esto corre dos veces, en paralelo?

Encontré 6 race conditions. Entre ellas:

→ Dos gastos simultáneos que juntos excedían el presupuesto, pero cada uno pasaba la validación por separado (write skew)
→ Dos depósitos concurrentes donde uno desaparecía (lost update)
→ Un refresh token robado que podía usarse en paralelo con el legítimo (replay)

Las cerré sin subir el nivel de aislamiento a SERIALIZABLE: locks pesimistas puntuales (SELECT … FOR UPDATE) sobre una "fila guardiana" por invariante, y constraints de base de datos donde los locks no llegan.

Y lo que más me enseñó: escribir tests de concurrencia que MUERDEN — saqué cada lock y verifiqué que el test correcto se pusiera rojo. Un test que no falla cuando quitás la protección no está probando la protección.

Escribí el análisis completo acá, con diagramas y el mapa de locks:
[link al artículo]

El código es público: [link al repo]

#backend #postgresql #nestjs #concurrency #softwareengineering

---

## Variante corta (si preferís algo más seco)

Encontré 6 race conditions en mi API de finanzas y las cerré sin SERIALIZABLE.

La lección que me llevo: read-modify-write se protege con locks; check-then-insert se protege con constraints. Y los tests de concurrencia solo valen si se ponen rojos cuando quitás el lock.

Análisis completo con diagramas: [link al artículo]
Código: [link al repo]

#backend #postgresql #concurrency
