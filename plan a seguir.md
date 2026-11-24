# Plan a seguir — StonksView

Plan de trabajo del equipo, organizado por fases. Cada tarea tiene su issue en GitHub y en el tablero (GitHub Project).

> **Nota:** este documento se reconstruyó el 23/11/2026 a partir de las 33 issues del repo (#8 a #40), porque el archivo original no estaba versionado. El contenido de cada tarea es el de su issue; si algo cambia, se actualiza la issue y este archivo en el mismo PR.

## Reglas de trabajo

- Toda tarea va en su **rama + PR revisado por otro integrante** (nadie mergea su propio PR sin review).
- Commits y títulos de PR en **Conventional Commits**.
- **WIP máximo 2** tareas en *Doing* por persona.
- El dueño de cada tarea es **una sugerencia**: se puede reasignar.
- Cada uso de IA queda registrado en `AI-DECISIONS.md` con su validación o corrección humana.
- Credenciales siempre por canal seguro, **nunca en el repo**.

## Hitos

| Hito | Fases que incluye |
|---|---|
| **Checkpoint 2 — Demo funcional** | Fases 0, 1, 2 y 3 + tareas transversales |
| **Defensa final** | Fase 4 |

**Fecha límite intermedia:** smoke test de AWS y decisión Plan A / Plan B antes del **02/11** (ver T.3).

## Arquitectura de referencia

- **Frontend:** Next.js con export estático en S3 + CloudFront (Plan B: Vercel).
- **Backend:** API Gateway + Lambda desplegadas con SAM. La lógica vive en `backend/src/core` y los handlers son adaptadores finos, para poder migrar al Plan B sin reescribir.
- **Datos y auth:** Supabase (Postgres + Auth + RLS). Prisma solo para schema y migraciones, nunca para queries en runtime.
- **Lógica atómica:** funciones Postgres (`transfer_holding`, `sell_holding`) invocadas por RPC.
- **IA:** LLM vía Groq, que recibe métricas ya calculadas y solo devuelve texto.
- **Scheduler:** EventBridge Scheduler para alertas (Plan B3: GitHub Actions schedule o Vercel Cron).
- **CI/CD:** GitHub Actions.

---

## Fase 0 — Setup

| # | Tarea | Dueño | Depende de | Hecho cuando | Issue |
|---|---|---|---|---|---|
| 0.1 | Crear el GitHub Project (Kanban) con columnas Backlog, Todo, Doing, Review y Done; WIP máximo 2 en Doing por persona; cargar todas las tareas del plan | Valentín | — | El tablero existe y tiene las tareas | #8 |
| 0.2 | Crear el proyecto en Supabase y compartir las credenciales por un canal seguro (nunca por el repo) | Bautista | — | Hay URL, anon key y `DATABASE_URL` disponibles para el equipo | #9 |
| 0.3 | Cuenta AWS: verificar free tier o créditos, crear una alarma en AWS Budgets antes de cualquier otro recurso y crear el rol IAM con OIDC para que GitHub Actions despliegue sin access keys | Fermín | — | Alarma de presupuesto activa y el rol permite desplegar desde Actions | #10 |
| 0.4 | Agregar `.env.example` documentando las variables (Supabase, Groq, VAPID, AWS) sin valores reales | Fermín | — | Archivo en el repo, sin secretos | #11 |

## Fase 1 — Base de datos y backend

| # | Tarea | Dueño | Depende de | Hecho cuando | Issue |
|---|---|---|---|---|---|
| 1.1 | Migración inicial con Prisma: aplicar `prisma/schema.prisma` a Supabase, incluida `ai_insights`. Prisma solo para schema y migraciones | Bautista | 0.2 | Las 12 tablas existen en Supabase | #12 |
| 1.2 | CHECK constraints documentados en el schema y políticas RLS por portfolio/usuario | Bautista | 1.1 | Un usuario no puede leer el portfolio de otro (con prueba) | #13 |
| 1.3 | Función Postgres `transfer_holding`: transferencia atómica entre sedes propias que actualiza o crea el holding destino conservando costo base y fecha de adquisición, y registra la fila en `transfers` | Valentín | 1.1 | Transfiere sin generar venta ni alterar el costo base | #14 |
| 1.4 | Función Postgres `sell_holding` (FIFO/LIFO): consume lotes, calcula `proceeds`, `cost_basis` y `realized_gain`, guarda `lots_consumed` y crea la fila en `sales` | Bautista | 1.1 | Calcula `realized_gain` correctamente para FIFO y LIFO | #15 |
| 1.5 | Cliente de Supabase y auth: cliente para el frontend y módulo compartido para las Lambdas, que usa el JWT del usuario para que RLS aplique | Fermín | 0.2 | El login funciona y la sesión se mantiene | #16 |
| 1.6 | Base de IaC: plantilla SAM, API Gateway + Lambda, bundle con esbuild y estructura `backend/src/core` (lógica en core, handlers como adaptadores finos) | Fermín | 0.3 | `sam deploy` crea una Lambda de ejemplo | #17 |
| 1.7 | Lambdas de portfolios y holdings: CRUD con validación zod y autenticación | Fermín | 1.1, 1.5, 1.6 | Un usuario autenticado crea y lista holdings | #18 |
| 1.8 | Lambdas `POST /transfers` y `POST /sales`: validan sesión y propiedad del holding e invocan `transfer_holding` y `sell_holding` por RPC | Valentín | 1.3, 1.4, 1.7 | Los endpoints responden y respetan RLS | #19 |
| 1.9 | `GET /health` con verificación de la conexión a la base | Fermín | 1.6 | Devuelve 200 en producción | #20 |

## Fase 2 — Calidad, CI/CD y observabilidad

| # | Tarea | Dueño | Depende de | Hecho cuando | Issue |
|---|---|---|---|---|---|
| 2.1 | CI: workflow de GitHub Actions con lint, typecheck y build en cada PR | Fermín | — | El check es obligatorio para mergear | #21 |
| 2.2 | Tests de integración: la transferencia conserva costo base y fecha, venta FIFO/LIFO y aislamiento por RLS entre usuarios | Valentín | 1.2, 1.3, 1.4 | Los tests corren en CI y pasan | #22 |
| 2.3 | CD: al mergear a `main`, deploy de SAM + frontend a S3 + invalidación de CloudFront, y verificación de `/health` después del deploy | Fermín | 0.3, 1.6, 1.9 | Un merge a `main` despliega solo | #23 |
| 2.4 | Observabilidad: logs estructurados con id de request y latencia, alarma de errores y dashboard básico en CloudWatch | Bautista | 1.6 | Se ve un request con su id y su latencia en CloudWatch | #24 |
| 2.5 | Proteger `main`: PR obligatorio, 1 review y CI verde | Valentín | 2.1 | La regla está activa | #25 |

## Fase 3 — Frontend

| # | Tarea | Dueño | Depende de | Hecho cuando | Issue |
|---|---|---|---|---|---|
| 3.1 | Pantallas de login y registro contra Supabase Auth | Fermín | 1.5 | Se puede registrar e iniciar sesión | #26 |
| 3.2 | Alta manual de holdings: formulario con símbolo, clase de activo, cantidad, costo base, sede y fecha | Bautista | 1.7, 3.1 | Se crea y se ve la tenencia | #27 |
| 3.3 | Dashboard consolidado: patrimonio total y composición por sede y clase de activo | Valentín | 1.7 | Los números coinciden con la base | #28 |
| 3.4 | Formulario de transferencia interna para mover un activo entre sedes propias | Bautista | 1.8, 3.2 | Transfiere sin afectar el costo base | #29 |
| 3.5 | Hosting del frontend: `output: export` en Next.js y distribución de CloudFront sobre S3 (Plan B: Vercel) | Fermín | 0.3 | La app carga desde la URL de CloudFront | #30 |

## Fase 4 — IA, precios y alertas *(Defensa final)*

| # | Tarea | Dueño | Depende de | Hecho cuando | Issue |
|---|---|---|---|---|---|
| 4.1 | Motor de métricas determinístico en el backend: patrimonio por sede, ganancia no realizada y concentración de riesgo | Valentín | 1.7 | Las métricas son exactas y tienen tests | #31 |
| 4.2 | Endpoint de insight con LLM (Groq): prompt con métricas ya calculadas, timeout corto, guardado en `ai_insights`, rate limit por usuario/día y degradación a `no_disponible` | Bautista | 4.1 | Devuelve el insight o `no_disponible` sin romper el dashboard | #32 |
| 4.3 | UI del insight: mostrar el insight y el estado no disponible | Fermín | 4.2 | Se ve el insight en el dashboard | #33 |
| 4.4 | Precios actuales con `price_cache`: integrar CoinGecko/Yahoo con cache; la carga manual de precio queda de respaldo | Fermín | 1.7 | Las tenencias se valúan automáticamente | #34 |
| 4.5 | Alertas de precio y Web Push: Lambda de chequeo idempotente invocada por EventBridge Scheduler y envío con `web-push` (Plan B3: GitHub Actions schedule o Vercel Cron) | Valentín | 1.6, 4.4 | Una alerta cumplida dispara la notificación y marca `triggered_at` | #35 |
| 4.6 | Prueba de resiliencia: simular la falla del LLM y mostrar que el dashboard sigue funcionando | Bautista | 4.2 | Evidencia lista para la defensa | #36 |
| 4.7 | *(Opcional)* Importación de tenencias por CSV: subida vía S3 y alta masiva de holdings | — | 1.7 | Se importa un CSV de ejemplo | #37 |

## Transversales

| # | Tarea | Dueño | Depende de | Hecho cuando | Issue |
|---|---|---|---|---|---|
| T.1 | Entradas en `AI-DECISIONS.md` por cada uso de IA, con una validación o corrección humana concreta. Pendientes: arquitectura y stack AWS, funciones Postgres y RLS, elección del cron, prompt del LLM | — | — | Hay una entrada por cada tema, con error o corrección real | #38 |
| T.2 | Actualizar `readme.md` y `StonksView_Arquitectura.md` para reflejar AWS y Groq (el README dice que no hay scheduler ni push y habla de LLM gestionado; la arquitectura dice Vercel) | — | — | Los tres documentos son coherentes entre sí | #39 |
| T.3 | Smoke test de AWS y decisión Plan A / Plan B **(límite 02/11)**: Lambda `/health` desplegada por CI contra Supabase y frontend en CloudFront. Si no anda, pasar al escenario que corresponda del plan | Valentín | 0.3, 1.6, 1.9 | Decisión documentada en `AI-DECISIONS.md` | #40 |

## Planes B

| Pieza | Plan A | Plan B |
|---|---|---|
| Frontend | S3 + CloudFront | Vercel |
| Backend | API Gateway + Lambda (SAM) | Vercel, reutilizando `backend/src/core` |
| Scheduler de alertas (B3) | EventBridge Scheduler | GitHub Actions schedule o Vercel Cron |

## Camino crítico para el Checkpoint 2

Dependencias tal como figuran en las issues:

```
1.7 (CRUD)          ← 1.1 + 1.5 + 1.6
1.8 (transfers/sales) ← 1.3 + 1.4 + 1.7
3.4 (UI transferencia) ← 1.8 + 3.2
3.2 (alta holdings) ← 1.7 + 3.1
2.2 (tests)         ← 1.2 + 1.3 + 1.4
2.3 (CD)            ← 0.3 + 1.6 + 1.9

donde  1.1 ← 0.2   1.5 ← 0.2   1.6 ← 0.3   1.9 ← 1.6   3.1 ← 1.5
       1.2 / 1.3 / 1.4 ← 1.1
```
