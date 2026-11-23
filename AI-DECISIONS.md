Log de auditoría de decisiones asistidas por IA — StonksView (TPI Desarrollo de Software Cloud, UTN FRLP 2026).

Este archivo documenta el razonamiento técnico detrás de cada fragmento de código o diseño generado con ayuda de un asistente de IA, siguiendo la estructura pedida por la cátedra:

- **Problema abordado:** descripción del desafío técnico.
- **Prompt / Herramienta utilizada:** instrucción enviada y asistente empleado.
- **Código / Arquitectura generada:** resumen de la propuesta de la IA.
- **Validación y Corrección Humana:** análisis crítico donde se identifican y corrigen alucinaciones, ineficiencias de rendimiento o riesgos de seguridad.

---

## 28/08/2026 — Selección y validación del proyecto
- **Problema abordado:** Desarrollar una idea de proyecto y expandirlo para poder cumplir con la idea de la materia. 
- **Prompt / Herramienta utilizada:** Conversación con Claude.
- **Código / Arquitectura generada:** Claude generó muchas formas de ampliar el proyecto y ayudó con la redacción del one-pager para la primera entrega. También opinó sobre el stack tentativo y que tecnologías pueden llegar a ser más convenientes.
- **Validación y Corrección Humana:** Se analizaron las ideas y se iban expandiendo o descartando según opinión nuestra, principalmente para ver si nos convencían o no, o si la IA se iba del camino que más nos gustaba y proponía ideas no muy útiles. 

---

## 21/09/2026 — Diseño del schema de base de datos (Prisma) para StonksView
- **Problema abordado:** Definir la estructura de base de datos para StonksView reutilizando una base de datos ya existente, identificando qué tablas se podían aprovechar tal cual y qué había que sumar puntualmente para las funcionalidades nuevas del proyecto (insights generados por IA).
- **Prompt / Herramienta utilizada:** Conversación con Claude (Claude Desktop) para analizar el modelo de datos existente y documentar, tabla por tabla, cuáles correspondían a la base real ya disponible y cuál era la única necesaria para lo nuevo que aporta StonksView.
- **Código / Arquitectura generada:** Claude describió un schema de 12 tablas en total. 11 son parte de la base ya existente, organizadas en: núcleo de portfolio (portfolios, holdings, transactions), movimientos con lógica propia (transfers, sales), precios (price_cache, price_history_cache), historial y seguimiento (snapshots, news_watches) y alertas/notificaciones (price_alerts, push_subscriptions). La única tabla nueva que suma StonksView es ai_insights, que guarda el contexto exacto enviado al LLM (para que quede auditable) y el texto devuelto, con un estado no_disponible para cuando la llamada falla.
- **Validación y Corrección Humana:** Se revisó que las 11 tablas heredadas de la base existente reflejaran fielmente los campos y la lógica ya definida (por ejemplo los campos específicos de holdings como fee, lockupExpiry y ratio, o el detalle de lotsConsumed en sales), confirmando que ai_insights fuera efectivamente la única tabla nueva necesaria, sin duplicar estructura ya resuelta en la base original.

---

## 16/11/2026 — Archivos `.env.example` del frontend y del backend
- **Problema abordado:** Documentar todas las variables de entorno del proyecto (Supabase, Prisma, Groq, VAPID y AWS) sin exponer valores reales, y evitar que algún secreto termine en el bundle del navegador.
- **Prompt / Herramienta utilizada:** Claude Code, pidiéndole implementar la issue #11 tal como estaba definida en el plan del equipo (`plan a seguir.md`).
- **Código / Arquitectura generada:** Dos archivos separados. `frontend/.env.example` contiene solo las variables públicas con prefijo `NEXT_PUBLIC_` (`API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`), con los mismos nombres que usa `deploy.yml`. `.env.example` en la raíz contiene las del backend y Prisma: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `GROQ_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `AWS_REGION`. Cada variable lleva un comentario con de dónde se obtiene y si es pública o secreta.
- **Validación y Corrección Humana:** El plan afirmaba que el `.gitignore` ignoraba `.env*` sin afectar a los `.example`. Eso es cierto para el `.gitignore` de la raíz, pero no para `frontend/.gitignore`, que sí ignora `.env*` completo: el `frontend/.env.example` nunca se habría subido. Se agregó la excepción `!.env.example` y se comprobó con `git check-ignore` que los `.example` quedan versionados y que `.env` y `.env.local` siguen ignorados. Se revisó que ningún archivo tuviera valores reales (solo placeholders), que la `service_role` y el `DATABASE_URL` quedaran marcados como secretos por saltear RLS, y que el `DATABASE_URL` de ejemplo pasara `prisma validate`.

---

## 16/11/2026 — Credenciales de deploy a AWS sin OIDC (tarea 0.3)
- **Problema abordado:** Configurar la cuenta de AWS para que GitHub Actions pueda desplegar (tarea 0.3). El plan original usaba un rol IAM con OIDC para evitar access keys, pero al intentarlo se encontró que la cuenta está en el plan free de AWS, cuya SCP de organización (administrada por AWS) niega explícitamente todas las acciones `iam:*OpenIDConnectProvider*`. Editar esa SCP requiere pasar la cuenta a plan pago.
- **Prompt / Herramienta utilizada:** Claude Code, con acceso de lectura a la cuenta por AWS CLI. Se le pidió revisar el estado de la tarea 0.3, diagnosticar el bloqueo y proponer alternativas.
- **Código / Arquitectura generada:** La IA diagnosticó el origen del bloqueo (SCP de la organización del plan free, roles `/managed/` de AWS) y comparó cuatro caminos: hacer el upgrade para editar la SCP, usar un usuario IAM con access keys, hacer el deploy manual o pasar al Plan B (Vercel). Con el camino elegido creó un budget mensual de USD 10 (avisos al 50/80/100% real y 100% pronosticado, midiendo gasto bruto sin créditos), el usuario `github-actions-deploy` con una policy de mínimo privilegio (`StonksViewGitHubDeploy`, acotada a recursos `stonksview-*` en us-east-2) y adaptó `deploy.yml` para usar las access keys desde los secrets del environment `production`.
- **Validación y Corrección Humana:** Se descartó, por ahora, el upgrade a plan pago (implica que el gasto por encima de los créditos se cobre a la tarjeta). Antes de elegir el camino de access keys se pidió verificarlo con una prueba reversible: crear y borrar un usuario y una access key de prueba. La policy se validó con IAM Access Analyzer (la primera versión tenía ARNs mal formados por la expansión de variables del shell y se corrigió). Para cerrar la escalada de privilegios se limitó `iam:PassRole` a Lambda y `iam:AttachRolePolicy` a `AWSLambdaBasicExecutionRole`. Queda como riesgo aceptado `iam:PutRolePolicy` sobre roles `stonksview-*`. Las access keys las genera y carga un integrante del equipo directamente en GitHub, sin pasar por la IA. También se evaluó volver al Plan B (Vercel + Supabase); se decidió seguir con AWS.

---

## 23/11/2026 — Función Postgres `transfer_holding` (issue #14)
- **Problema abordado:** Transferir una tenencia entre dos sedes propias (ej. de Binance a una wallet Ledger) de forma atómica, sin generar una venta y sin alterar el costo base. Cada fila de `holdings` es un lote con costo **por unidad** y fecha de adquisición propios (se puede haber comprado BTC a varios precios distintos).
- **Prompt / Herramienta utilizada:** Claude Code (Opus) a partir del issue #14, el `schema.prisma` y `StonksView_Arquitectura.md`.
- **Código / Arquitectura generada:** `prisma/sql/transfer_holding.sql`: función `SECURITY INVOKER` (respeta RLS) que verifica que el portfolio sea de `auth.uid()`, toma un advisory lock por (portfolio, símbolo) y bloquea el lote origen con `FOR UPDATE`. Transferencia parcial: descuenta del origen y en destino suma a un lote existente solo si coincide costo por unidad, fecha, ratio y lockup; si no, crea un lote nuevo. Transferencia total: reubica el mismo lote (le cambia la sede) en vez de borrarlo, así conserva id, `fee` e historial. Registra la fila en `transfers` y el par `transfer_out`/`transfer_in` en `transactions`, y devuelve un `jsonb` con los ids.
- **Validación y Corrección Humana:** La IA preguntó si `cost_basis` era por unidad o total del lote; se confirmó que es **por unidad con marca temporal**, lo que descarta promediar lotes (rompería la ganancia realizada y el FIFO/LIFO de `sell_holding`). En el code review de la PR (también con Claude Code) se detectó que la primera versión borraba el lote origen en una transferencia total: dependía de una policy de UPDATE sobre `transfers` (si no existía, el DELETE fallaba por FK) y dejaba en NULL los enlaces de transferencias anteriores, perdiendo la trazabilidad del costo base. También que el merge ignoraba `lockup_expiry`, que no se registraba nada en `transactions`, que dos transferencias cruzadas simultáneas podían caer en deadlock y que las sedes se comparaban distinguiendo mayúsculas. Se corrigió todo eso y se re-probó contra un Postgres en memoria (PGlite) con el schema generado por Prisma y RLS sin UPDATE/DELETE en `transfers`: 30 casos (parcial, merge, distinto precio y lockup, reubicación total con historial intacto, conservación de cantidad y costo total, sedes sin distinguir mayúsculas, errores de cantidad/sede/usuario ajeno/anon y rollback). La concurrencia real no se pudo probar en PGlite (una sola conexión). Queda pendiente aplicar el SQL desde una migración, ya que el repo todavía no tiene `prisma/migrations`.

---

## 23/11/2026 — Base del backend serverless con SAM (tarea 1.6)
- **Problema abordado:** Crear la base de infraestructura como código del backend: una API HTTP en API Gateway con Lambdas, desplegable con SAM desde GitHub Actions, y una estructura de código que separe la lógica de dominio de AWS para no atar el proyecto a Lambda (facilita el Plan B a Vercel).
- **Prompt / Herramienta utilizada:** Claude Code, pidiéndole implementar la issue #17 siguiendo el plan de implementación y las decisiones transversales comentadas en la issue.
- **Código / Arquitectura generada:** Paquete `backend/` con TypeScript, `zod`, `@supabase/supabase-js` y `vitest`; lógica en `backend/src/core/` (sin dependencias de AWS) y `backend/src/handlers/` como adaptadores finos. `template.yaml` en la raíz (donde lo espera `deploy.yml`) con una HTTP API con CORS configurable por parámetro, una Lambda de ejemplo `GET /ping` en Node.js 22 sobre arm64 empaquetada con esbuild en formato ESM, y su log group con retención de 14 días. `samconfig.toml` con el stack `stonksview` en us-east-2. Nuevo job `backend` en CI que corre typecheck, tests, `sam validate --lint` y `sam build`.
- **Validación y Corrección Humana:** Se verificó localmente que pasan el typecheck, los tests, `sam validate --lint` y `sam build`, y que el bundle generado responde 200 al invocarlo con Node. El nombre del stack y de los recursos se alineó con la policy del usuario de deploy (`stonksview-*`), incluido un log group explícito para que la Lambda no dependa de permisos de creación fuera de ese prefijo. Se fijó TypeScript 5 (npm instalaba la 7 por defecto) para mantener la misma versión que el frontend, y se usó npm en lugar de pnpm en el backend porque el builder de esbuild de SAM instala dependencias con npm (`UseNpmCi`), así el lockfile que se prueba en CI es el mismo que se despliega. El `sam deploy` real queda pendiente hasta cargar las access keys del usuario de deploy.

---
