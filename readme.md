Trabajo Práctico Integrador — Desarrollo de Software Cloud (2026)
UTN Facultad Regional La Plata

**Integrantes:** _Valentin Torres · Bautista Flores · Fermin Etchanchu Paoltroni_

- Nombre del proyecto: StonksView

- Descripción del problema: Alguien con inversiones repartidas en un exchange cripto, una wallet propia, un broker tradicional y un banco no tiene ninguna vista consolidada de su patrimonio: cada plataforma reporta su propio saldo, en su propia moneda, sin relación entre sí — armar el total hoy significa sumar todo a mano en una planilla. El problema se agrava cuando esa persona mueve fondos entre sus propias cuentas (por ejemplo, transferir criptomonedas de un exchange a una wallet propia): las herramientas de carga manual típicas no distinguen ese movimiento interno de una operación de mercado real, lo registran como venta + compra, y terminan corrompiendo el costo base y el cálculo de rendimiento.

- Propuesta de valor: StonksView es una plataforma donde el usuario carga manualmente (o por CSV) sus tenencias en cada sede — exchange, wallet, broker, banco — y obtiene un dashboard consolidado de patrimonio total. El punto central del producto es la **transferencia interna atómica**: mover un activo de una sede propia a otra sin que el sistema lo confunda con una venta, preservando el costo base y la fecha de adquisición originales. Sobre esos datos ya consolidados y correctos, una capa de IA genera insights en lenguaje natural — nunca calculando cifras nuevas, solo interpretando las que ya calculó el motor determinístico del sistema (mismo principio que en Umbral: la IA explica, no inventa el número):
	- Alta manual o por CSV de tenencias por sede (símbolo, clase de activo, cantidad, costo base, fecha).
	- Dashboard consolidado: patrimonio total y composición por clase de activo y por sede.
	- Transferencia interna entre sedes propias, sin corromper costo base ni generar ganancia impositiva falsa.
	- Insight en lenguaje natural sobre concentración de riesgo por sede y posiciones destacadas, citando siempre el dato de origen (ej. "62% de tu patrimonio está en una sola sede").

- Usuarios objetivo: - **Primario:** personas con inversiones distribuidas en más de una plataforma (cripto + banco + broker) que hoy arman su patrimonio a mano en una planilla y no tienen ninguna vista unificada.

- Stack:

| Componente | Tecnología | Justificación |
|---|---|---|
| Frontend | Next.js con export estático, servido desde S3 + CloudFront | Toda la app es cliente (la sesión vive en Supabase Auth y los datos vienen de la API), así que no necesita servidor: archivos estáticos detrás de una CDN. |
| Backend / API | API Gateway (HTTP API) + AWS Lambda en Node.js 22, desplegadas con AWS SAM | Serverless: se paga por request y no hay servidor ocioso. La lógica vive en `backend/src/core` y los handlers son adaptadores finos, para poder pasar a Vercel (Plan B) sin reescribirla. |
| Persistencia | Supabase (PostgreSQL gestionado), con Row-Level Security por portfolio | Dato financiero sensible: RLS asegura que un usuario nunca pueda leer tenencias de otro, incluso ante un bug de autorización en la API. Las operaciones atómicas (`transfer_holding`, `sell_holding`) son funciones de Postgres. |
| Autenticación | Supabase Auth | Sesión por usuario; las Lambdas reenvían el JWT a Supabase para que RLS se aplique. |
| IA | Modelo open-source (Llama) vía la API de Groq, recibiendo como contexto las métricas ya calculadas por el sistema (sin vector DB, sin RAG) | El "conocimiento" que necesita el modelo ya está en las tablas del propio producto; armar una base vectorial sería sobre-ingeniería para este volumen de datos por usuario. |
| Precios de mercado | CoinGecko (cripto) y Yahoo Finance (acciones, ETF y CEDEAR), cacheados en `price_cache` por 5 minutos | Valúan las tenencias automáticamente; si la API falla se usa el último precio guardado, y la carga manual queda de respaldo. |
| Alertas y notificaciones | EventBridge Scheduler invoca una Lambda de chequeo; envío con Web Push (`web-push`, claves VAPID) | Chequeo periódico sin un proceso corriendo 24/7. |
| CI/CD y observabilidad | GitHub Actions (CI en cada PR, deploy al mergear a `main`); logs en CloudWatch y `GET /health` verificado después de cada deploy | El deploy queda automatizado y se detecta enseguida si rompió la conexión con la base. |

Los Planes B (Vercel para frontend y backend, GitHub Actions schedule o Vercel Cron para las alertas) y el detalle de cada decisión están en `StonksView_Arquitectura.md` y en `plan a seguir.md`.

## Desarrollo local

En local, la app se conecta al **proyecto de Supabase del equipo** (la misma base que usa el deploy). No hace falta pedirle a nadie la URL ni la clave: están guardadas como **variables del repo en GitHub**, y un script las baja y arma los archivos de entorno.

### Cómo está armado

| Valor | Dónde está en GitHub | Lo puede leer | Para qué |
|---|---|---|---|
| `SUPABASE_URL` | Variable del repo | Cualquiera con acceso al repo | API local, frontend y deploy |
| `SUPABASE_ANON_KEY` | Variable del repo | Cualquiera con acceso al repo | API local, frontend y deploy. Es la *publishable key* de Supabase (`sb_publishable_...`): pública por diseño, lo que protege los datos es RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret del environment `production` | Solo los workflows de Actions | Deploy: escribir `price_cache` |
| `DATABASE_URL`, `GROQ_API_KEY` | Canal seguro del equipo | Quien la necesite | Migraciones con Prisma e insights con IA |

Las variables se ven en GitHub en **Settings → Secrets and variables → Actions → Variables**. Los *secrets* de GitHub, en cambio, no se pueden leer fuera de Actions: por eso lo secreto no entra en el script.

### Requisitos

- Node 22 o superior y pnpm (`npm install -g pnpm`).
- La CLI de GitHub ([cli.github.com](https://cli.github.com/)), logueada con una cuenta que tenga acceso al repo:

  ```bash
  gh auth login
  gh auth status   # tiene que mostrar tu usuario
  ```

### Paso a paso

Todos los comandos se corren desde la raíz del repo.

1. **Instalar dependencias** (una sola vez, y cada vez que cambie un `package.json`):

   ```bash
   cd backend && npm ci && cd ..
   cd frontend && pnpm install && cd ..
   ```

2. **Generar los archivos de entorno:**

   ```bash
   node scripts/setup-env.mjs
   ```

   Lee `SUPABASE_URL` y `SUPABASE_ANON_KEY` del repo con `gh` y escribe:

   - `.env` en la raíz: `SUPABASE_URL` y `SUPABASE_ANON_KEY`, para la API local.
   - `frontend/.env.local`: las mismas con prefijo `NEXT_PUBLIC_`, más `NEXT_PUBLIC_API_URL=http://localhost:3001`.

   Los dos archivos están en `.gitignore`. Si ya existen, el script reemplaza solo esas claves y deja el resto (por ejemplo, un `DATABASE_URL` agregado a mano), así que se puede volver a correr cuando cambie una variable.

3. **Levantar la API local** (puerto 3001), en una terminal:

   ```bash
   cd backend
   npm run dev
   ```

   Abrí `http://localhost:3001/health`: tiene que responder `200` con `"database":"ok"`. Si da `503`, la API no llega a Supabase (ver *Problemas comunes*).

4. **Levantar el frontend** (puerto 3000), en otra terminal:

   ```bash
   cd frontend
   pnpm dev
   ```

   Abrí `http://localhost:3000`: redirige a la pantalla de inicio de sesión.

5. **Crear tu usuario** desde *Registrate*. El proyecto tiene activada la confirmación de email: antes de iniciar sesión hay que abrir el mail de Supabase y confirmar la cuenta.

### Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| `variable SUPABASE_URL was not found` | Las variables no están cargadas en el repo, o `gh` apunta a otro repo. Revisá con `gh variable list` desde la raíz del repo. |
| `failed to run git: not a git repository` | El script se corrió fuera del repo. Corrélo desde la raíz. |
| `gh: command not found` / `no se encontró el comando gh` | Falta instalar la CLI de GitHub, o abrir una terminal nueva después de instalarla. |
| `/health` responde `503` | Falta el `.env` en la raíz o tiene valores viejos. Volvé a correr el script y reiniciá `npm run dev`. |
| El frontend muestra "This page couldn't load" | Falta `frontend/.env.local`. Corré el script y reiniciá `pnpm dev` (Next lee el archivo al arrancar). |
| No puedo iniciar sesión después de registrarme | Falta confirmar el email. |

Sin `SUPABASE_SERVICE_ROLE_KEY` en el `.env`, la app funciona igual pero no guarda en cache los precios que trae de CoinGecko y Yahoo.

### Cargar o cambiar las variables (mantenimiento)

Solo hace falta si se rota una clave o se cambia de proyecto de Supabase. Los valores están en el dashboard de Supabase, en **Project Settings → API Keys**:

```bash
gh variable set SUPABASE_URL --body "https://<ref>.supabase.co"
gh variable set SUPABASE_ANON_KEY --body "sb_publishable_..."
```

La *secret key* (`sb_secret_...`) nunca va como variable: es un secret y se carga con `gh secret set SUPABASE_SERVICE_ROLE_KEY --env production` (pide el valor sin dejarlo en el historial). Después de cambiar una variable, cada integrante vuelve a correr `node scripts/setup-env.mjs`.

### Tests

Los tests del backend no usan Supabase: corren contra un Postgres en memoria (PGlite) con las migraciones de `prisma/migrations`.

```bash
cd backend
npm test
```

En Windows, si algún archivo falla con `Worker exited unexpectedly`, es falta de memoria al correr en paralelo: `npx vitest run --no-file-parallelism` los corre de a uno.

## Deploy a AWS

Cada merge a `main` corre el workflow `Deploy` (`.github/workflows/deploy.yml`): despliega el backend con SAM (API Gateway + Lambdas en `us-east-2`), arma el frontend como export estático, lo sube a S3, invalida CloudFront y verifica `GET /health`. Está apagado hasta que `AWS_DEPLOY_ENABLED` valga `true`.

### Checklist para el primer deploy

**1. En AWS** (consola, con un usuario que no sea el de deploy):

- Bucket S3 privado para el frontend, con nombre `stonksview-*` (la policy de deploy solo permite ese prefijo).
- Distribución de CloudFront con ese bucket como origen (Origin Access Control, bucket sin acceso público).
- La CloudFront Function de `infra/cloudfront/rewrite-index.js` asociada a la distribución en *viewer request* (runtime `cloudfront-js-2.0`). Sin ella, recargar en `/login` da error.
- Permisos de la policy `StonksViewGitHubDeploy`: además de lo que ya tiene, el job crea el bucket de artefactos de SAM `stonksview-sam-artifacts-<cuenta>-us-east-2` (`s3:CreateBucket`, `s3:PutBucketPublicAccessBlock`, `s3:ListBucket`, `s3:PutObject`, `s3:GetObject`) y necesita los permisos de CloudWatch y SNS que lista el comentario de `deploy.yml`.

**2. En GitHub** (variables del repo):

```bash
gh variable set S3_BUCKET --body "stonksview-..."
gh variable set CLOUDFRONT_DISTRIBUTION_ID --body "E..."
gh variable set FRONTEND_URL --body "https://xxxx.cloudfront.net"   # sin barra final
```

`FRONTEND_URL` es el único origen que acepta el CORS de la API desplegada: si no coincide exacto con la URL del navegador, todos los pedidos del frontend fallan. `SUPABASE_URL` y `SUPABASE_ANON_KEY` ya están cargadas (ver *Desarrollo local*). La URL de la API no se carga: el workflow la lee del stack después de desplegar.

Secrets del environment `production` (opcionales para el primer deploy):

```bash
gh secret set SUPABASE_SERVICE_ROLE_KEY --env production   # sin ella, no se cachean precios
gh secret set GROQ_API_KEY --env production                # sin ella, el insight responde no_disponible
```

**3. En Supabase:** Authentication → URL Configuration → *Site URL* y *Redirect URLs* con la `FRONTEND_URL`. Si no, el mail de confirmación del registro lleva a `localhost`.

**4. Encender y lanzar:**

```bash
gh variable set AWS_DEPLOY_ENABLED --body "true"
gh workflow run Deploy
gh run watch
```

El resumen del run muestra la URL de la API y la del frontend. Si un paso falla con `AccessDenied`, el mensaje dice qué acción y qué recurso faltan en la policy.
