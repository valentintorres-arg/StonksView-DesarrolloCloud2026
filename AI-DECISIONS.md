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

## 23/11/2026 — Función Postgres `transfer_holding` (issue #14)
- **Problema abordado:** Transferir una tenencia entre dos sedes propias (ej. de Binance a una wallet Ledger) de forma atómica, sin generar una venta y sin alterar el costo base. Cada fila de `holdings` es un lote con costo **por unidad** y fecha de adquisición propios (se puede haber comprado BTC a varios precios distintos).
- **Prompt / Herramienta utilizada:** Claude Code (Opus) a partir del issue #14, el `schema.prisma` y `StonksView_Arquitectura.md`.
- **Código / Arquitectura generada:** `prisma/sql/transfer_holding.sql`: función `SECURITY INVOKER` (respeta RLS) que verifica que el portfolio sea de `auth.uid()`, toma un advisory lock por (portfolio, símbolo) y bloquea el lote origen con `FOR UPDATE`. Transferencia parcial: descuenta del origen y en destino suma a un lote existente solo si coincide costo por unidad, fecha, ratio y lockup; si no, crea un lote nuevo. Transferencia total: reubica el mismo lote (le cambia la sede) en vez de borrarlo, así conserva id, `fee` e historial. Registra la fila en `transfers` y el par `transfer_out`/`transfer_in` en `transactions`, y devuelve un `jsonb` con los ids.
- **Validación y Corrección Humana:** La IA preguntó si `cost_basis` era por unidad o total del lote; se confirmó que es **por unidad con marca temporal**, lo que descarta promediar lotes (rompería la ganancia realizada y el FIFO/LIFO de `sell_holding`). En el code review de la PR (también con Claude Code) se detectó que la primera versión borraba el lote origen en una transferencia total: dependía de una policy de UPDATE sobre `transfers` (si no existía, el DELETE fallaba por FK) y dejaba en NULL los enlaces de transferencias anteriores, perdiendo la trazabilidad del costo base. También que el merge ignoraba `lockup_expiry`, que no se registraba nada en `transactions`, que dos transferencias cruzadas simultáneas podían caer en deadlock y que las sedes se comparaban distinguiendo mayúsculas. Se corrigió todo eso y se re-probó contra un Postgres en memoria (PGlite) con el schema generado por Prisma y RLS sin UPDATE/DELETE en `transfers`: 30 casos (parcial, merge, distinto precio y lockup, reubicación total con historial intacto, conservación de cantidad y costo total, sedes sin distinguir mayúsculas, errores de cantidad/sede/usuario ajeno/anon y rollback). La concurrencia real no se pudo probar en PGlite (una sola conexión). Queda pendiente aplicar el SQL desde una migración, ya que el repo todavía no tiene `prisma/migrations`.
