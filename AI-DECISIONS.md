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

## 23/11/2026 — Base del backend serverless con SAM (tarea 1.6)
- **Problema abordado:** Crear la base de infraestructura como código del backend: una API HTTP en API Gateway con Lambdas, desplegable con SAM desde GitHub Actions, y una estructura de código que separe la lógica de dominio de AWS para no atar el proyecto a Lambda (facilita el Plan B a Vercel).
- **Prompt / Herramienta utilizada:** Claude Code, pidiéndole implementar la issue #17 siguiendo el plan de implementación y las decisiones transversales comentadas en la issue.
- **Código / Arquitectura generada:** Paquete `backend/` con TypeScript, `zod`, `@supabase/supabase-js` y `vitest`; lógica en `backend/src/core/` (sin dependencias de AWS) y `backend/src/handlers/` como adaptadores finos. `template.yaml` en la raíz (donde lo espera `deploy.yml`) con una HTTP API con CORS configurable por parámetro, una Lambda de ejemplo `GET /ping` en Node.js 22 sobre arm64 empaquetada con esbuild en formato ESM, y su log group con retención de 14 días. `samconfig.toml` con el stack `stonksview` en us-east-2. Nuevo job `backend` en CI que corre typecheck, tests, `sam validate --lint` y `sam build`.
- **Validación y Corrección Humana:** Se verificó localmente que pasan el typecheck, los tests, `sam validate --lint` y `sam build`, y que el bundle generado responde 200 al invocarlo con Node. El nombre del stack y de los recursos se alineó con la policy del usuario de deploy (`stonksview-*`), incluido un log group explícito para que la Lambda no dependa de permisos de creación fuera de ese prefijo. Se fijó TypeScript 5 (npm instalaba la 7 por defecto) para mantener la misma versión que el frontend, y se usó npm en lugar de pnpm en el backend porque el builder de esbuild de SAM instala dependencias con npm (`UseNpmCi`), así el lockfile que se prueba en CI es el mismo que se despliega. El `sam deploy` real queda pendiente hasta cargar las access keys del usuario de deploy.
