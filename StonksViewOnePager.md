# StonksView

**Consolidación patrimonial multi-sede con insights de IA**

Trabajo Práctico Integrador — Desarrollo de Software Cloud (2026)
UTN Facultad Regional La Plata

**Integrantes:** _Torres Valentin · Etchanchu Fermin · Flores Bautista_
**Fecha:** 28/08/2026 — Entregable: One-Pager (Hito "Clase 1")

---

## 1. Descripción del problema

Alguien con inversiones repartidas en un exchange cripto, una wallet propia, un broker tradicional y un banco no tiene ninguna vista consolidada de su patrimonio: cada plataforma reporta su propio saldo, en su propia moneda, sin relación entre sí — armar el total hoy significa sumar todo a mano en una planilla. El problema se agrava cuando esa persona mueve fondos entre sus propias cuentas (por ejemplo, transferir criptomonedas de un exchange a una wallet propia): las herramientas de carga manual típicas no distinguen ese movimiento interno de una operación de mercado real, lo registran como venta + compra, y terminan corrompiendo el costo base y el cálculo de rendimiento.

## 2. Propuesta de valor

StonksView es una plataforma donde el usuario carga manualmente (o por CSV) sus tenencias en cada sede — exchange, wallet, broker, banco — y obtiene un dashboard consolidado de patrimonio total. El punto central del producto es la **transferencia interna atómica**: mover un activo de una sede propia a otra sin que el sistema lo confunda con una venta, preservando el costo base y la fecha de adquisición originales.

Sobre esos datos ya consolidados y correctos, una capa de IA genera insights en lenguaje natural — nunca calculando cifras nuevas, solo interpretando las que ya calculó el motor determinístico del sistema (mismo principio que en Umbral: la IA explica, no inventa el número):

- Alta manual o por CSV de tenencias por sede (símbolo, clase de activo, cantidad, costo base, fecha).
- Dashboard consolidado: patrimonio total y composición por clase de activo y por sede.
- Transferencia interna entre sedes propias, sin corromper costo base ni generar ganancia impositiva falsa.
- Insight en lenguaje natural sobre concentración de riesgo por sede y posiciones destacadas, citando siempre el dato de origen (ej. "62% de tu patrimonio está en una sola sede").

## 3. Usuarios objetivo

- **Primario:** personas con inversiones distribuidas en más de una plataforma (cripto + banco + broker) que hoy arman su patrimonio a mano en una planilla y no tienen ninguna vista unificada.

## 4. Stack tecnológico tentativo

| Componente | Tecnología propuesta | Justificación |
|---|---|---|
| Frontend | Next.js sobre Vercel | Despliegue rápido, ideal para iterar con equipo de 3 personas en tiempo acotado. |
| Backend / API | Funciones serverless (Next.js API routes) | Alcanza para el alcance del MVP; no se necesita un proceso persistente porque no hay scheduler ni notificaciones push en esta versión. |
| Persistencia | Supabase (PostgreSQL gestionado), con Row-Level Security por usuario | Dato financiero sensible — RLS asegura que un usuario nunca pueda leer tenencias de otro, incluso ante un bug de autorización en el API. |
| Autenticación | Supabase Auth | Sesión por usuario, requisito básico para cualquier dato patrimonial. |
| IA | API de un LLM gestionado, recibiendo como contexto las métricas ya calculadas por el sistema (sin vector DB, sin RAG completo) | El "conocimiento" que necesita el modelo ya está en las tablas del propio producto; armar una base vectorial sería sobre-ingeniería para este volumen de datos por usuario. |
| Precios de mercado *(stretch goal)* | API pública gratuita (CoinGecko / Yahoo Finance) para valuar tenencias automáticamente | Si el tiempo no alcanza, la carga de precio queda manual como fallback — no bloquea el resto del producto. |

*Stack tentativo sujeto a ajuste en el Checkpoint 1, una vez definida la arquitectura cloud en detalle.*

## 5. Diferenciación y alcance

Kubera y Vexon Finances ya resuelven este problema como producto completo y pago, con sincronización automática, inmuebles, alternativos y más. StonksView no compite en esa amplitud: se enfoca en resolver con rigor un único caso que las herramientas de carga manual genéricas rompen — distinguir una transferencia interna de una operación de mercado real, preservando el costo base — y sumarle una capa de insights con IA sobre datos que ya son correctos. Es un recorte deliberadamente chico y defendible del caso de estudio original en el que se inspira esta idea, del que se descartó a propósito todo lo que no entra en 3 personas y ~2 meses: motor de costo base FIFO/LIFO, tax-loss harvesting, rebalanceo, notificaciones push, PWA, i18n y despliegue en tres servicios cloud simultáneos. Esas quedan documentadas como decisiones de alcance, no como trabajo pendiente.
