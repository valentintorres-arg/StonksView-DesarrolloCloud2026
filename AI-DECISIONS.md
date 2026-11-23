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
- **Código / Arquitectura generada:** `prisma/sql/transfer_holding.sql`: función `SECURITY INVOKER` (respeta RLS) que bloquea el lote origen con `FOR UPDATE`, verifica que el portfolio sea de `auth.uid()`, y en destino suma a un lote existente solo si coincide costo por unidad, fecha y ratio; si no, crea un lote nuevo. Si se transfiere el lote entero lo borra y deja `from_holding_id = NULL` en `transfers`. Registra la fila en `transfers` y devuelve un `jsonb` con los ids.
- **Validación y Corrección Humana:** La IA preguntó si `cost_basis` era por unidad o total del lote; se confirmó que es **por unidad con marca temporal**, lo que descarta promediar lotes (rompería la ganancia realizada y el FIFO/LIFO de `sell_holding`). Se probó contra un Postgres real en memoria (PGlite) con el schema generado por Prisma: 29 casos (parcial, merge, lotes con distinto precio, transferencia total, conservación del costo total y la cantidad, errores de cantidad/sede/usuario ajeno/anon). Los tests detectaron que al transferir un lote entero que se suma a otro existente se perdía su `fee`; se corrigió para sumarla al destino.
