codigo acomplado bidireccionalmente entre budgets y transactions.
Posibles soluciones:
Criterio 1: El flujo de la "Intención" (¿Quién inicia la acción?)
Aunque ambos se necesiten, casi siempre hay un módulo que da la orden y otro que hace el trabajo secundario. Pregúntate: Si elimino uno de los dos procesos, ¿cuál de los dos módulos sigue teniendo sentido por sí mismo?
Ejemplo clásico: Un ModuloOrdenes necesita a ModuloFacturas para generar la factura de una compra, y ModuloFacturas necesita avisar a ModuloOrdenes para cambiar el estado de la orden a "Pagada".
Quién manda: La orden es el concepto principal. La factura es una consecuencia de la orden.
La decisión:
El ModuloOrdenes crea un puerto: "Necesito que alguien facture esto".
El ModuloFacturas implementa ese puerto como un adaptador.
Criterio 2: El Árbitro (La solución compartida)
Recomendado si ambos módulos tienen exactamente el mismo peso jerárquico.
Stack Overflow
Stack Overflow
+1
Si no puedes decidir quién es el dueño porque la relación de dependencia es un empate técnico (50/50), la regla dice que ninguno de los dos debería ser el dueño.
Crea un tercer módulo (un "Árbitro" o un módulo de orquestación).
Este nuevo módulo importará tanto al Módulo A como al Módulo B.
Toda la lógica que requería que se llamaran entre sí se mueve a este nuevo servicio.
Reddit
Reddit
+1
De esta forma: ModuloA y ModuloB se vuelven completamente independientes y limpios. El nuevo módulo orquestador se encarga de llamarlos en el orden correcto.
Criterio 3: El patrón de Eventos (La solución definitiva)
La mejor práctica en arquitecturas modernas para desacoplar sistemas que se llaman mutuamente.
Reddit
Reddit
+1
Si el Módulo A necesita que el Módulo B haga algo, pero al Módulo A no le importa el resultado inmediato ni cómo lo haga B, no uses puertos ni inyección de dependencias. Usa Eventos.
Reddit
Reddit
+1
En lugar de que ModuloA llame a ModuloB.ejecutarAlgo(), el ModuloA simplemente grita al sistema: @Emitir('usuario.creado').
El ModuloA termina su trabajo ahí. No importa si hay 0, 1 o 100 módulos escuchando.
El ModuloB tendrá un escucha @OnEvent('usuario.creado') y hará su trabajo de forma totalmente aislada.
DEV Community
DEV Community
Con este enfoque, eliminas las interfaces, los puertos, los adaptadores y la necesidad de importar módulos entre sí por completo. NestJS cuenta con el paquete oficial @nestjs/event-emitter para lograr esto de forma muy sencilla.
