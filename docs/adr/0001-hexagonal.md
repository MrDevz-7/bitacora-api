# ADR 0001: Arquitectura hexagonal (puertos y adaptadores)

- **Estado:** Aceptada
- **Fecha:** 2026-09-29

## Contexto

`bitacora-api` registra el proceso de uso de IA de un estudiante como una línea de tiempo de
eventos y expone REST y WebSocket. Tiene reglas de negocio que deben poder probarse sin levantar
infraestructura: la cadena de hashes que detecta manipulación, los permisos por rol
(student, teacher, admin) y el ciclo de vida de las entregas.

Además, hay varios mecanismos de entrada y salida (HTTP, WebSocket, workers de BullMQ) y varias
tecnologías de persistencia y mensajería (MongoDB, Redis) que probablemente cambiarán de forma
distinta a las reglas del negocio. El proyecto también es una pieza de portafolio y debe poder
leerse como código de producción.

## Decisión

Adoptamos arquitectura hexagonal con cuatro capas y dependencias **solo hacia adentro**:

```
interfaces ──► application ──► domain
infrastructure ──► application ──► domain
```

- `domain`: entidades, value objects y reglas puras. Solo puede importar de `domain` y de
  `node:crypto`. No conoce Express, Mongoose, Redis, BullMQ ni Zod.
- `application`: casos de uso y **puertos** (interfaces). Depende de `domain`.
- `infrastructure`: **adaptadores** que implementan los puertos (Mongo, Redis, colas, seguridad,
  logging, configuración).
- `interfaces`: HTTP y WebSocket. Traduce el protocolo a llamadas a casos de uso. De `domain` solo
  puede importar tipos (`import type`).

La inyección de dependencias es manual. `infrastructure/container.ts` construye adaptadores y casos
de uso. Los puntos de entrada `server.ts` y `worker.ts` son los **composition roots**: quedan fuera
de las capas y conectan el container con `interfaces`, de modo que `infrastructure` nunca importa
`interfaces`.

Las reglas se hacen cumplir automáticamente con `dependency-cruiser` (`npm run arch:check`,
ejecutado en CI). Una violación rompe el build.

## Alternativas consideradas

**1. MVC en capas (routes → controllers → services → models).** Es la estructura más común en
Express y la más rápida de arrancar. Se descartó porque los servicios terminan acoplados a los
modelos de Mongoose, lo que obliga a probar la lógica con una base de datos real o con mocks
frágiles, y porque nada impide que un controlador importe un modelo. Con el tiempo, las reglas de
negocio se dispersan entre capas.

**2. NestJS.** Ofrece módulos, inyección de dependencias y decoradores ya resueltos. Se descartó
porque oculta detrás del framework justo lo que el proyecto quiere demostrar (composición de
dependencias, separación de capas), porque los decoradores acoplan las clases al framework y
porque añade peso a una máquina con recursos limitados. Es una opción válida para un equipo grande
que valora la convención sobre la explicitud.

## Consecuencias

**Positivas**

- Las reglas de negocio se prueban con unit tests rápidos, usando fakes de los puertos.
- Cambiar de adaptador (otra base de datos, otra cola) no toca `domain` ni `application`.
- Las violaciones de arquitectura fallan en CI en lugar de detectarse en revisión.

**Negativas**

- Más código y más carpetas: hay que definir un puerto, un adaptador y un mapeo entre documentos
  de Mongoose y entidades del dominio.
- Añadir una funcionalidad toca cuatro capas.
- Para un CRUD simple es más ceremonia de la necesaria; se acepta a cambio de la testeabilidad y de
  demostrar el criterio de diseño.
- Sin path aliases, los imports relativos son más largos.

## Cumplimiento

`npm run arch:check` aplica las reglas de `.dependency-cruiser.cjs`: `domain` solo importa
`domain` y `node:crypto`; `application` no importa `infrastructure` ni `interfaces`;
`infrastructure` no importa `interfaces`; `interfaces` solo importa tipos de `domain`; sin ciclos;
sin imports irresolubles; y `src/` no usa devDependencies.
