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
