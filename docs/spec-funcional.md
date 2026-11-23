# Especificación funcional — StonksView

Qué hace la app y cómo se comporta, pantalla por pantalla y regla por regla.
Complementa a [`readme.md`](../readme.md) (el problema y la propuesta de valor)
y a [`StonksView_Arquitectura.md`](../StonksView_Arquitectura.md) (cómo está
construida). Si este documento contradice al schema
([`prisma/schema.prisma`](../prisma/schema.prisma)) o a las funciones SQL, se
corrige el documento o se abre una issue para cambiar el código: no pueden
quedar los dos distintos.

**Cómo leerlo.** Cada regla y cada pantalla tiene un identificador (`RN-03`,
`P4`) para poder citarla en issues y PRs. Las marcas indican de dónde sale cada
cosa:

- Sin marca: ya está definido en el readme, la arquitectura, el schema o el
  código existente.
- **[Propuesta]**: no estaba definido; es la opción que se propone para no
  bloquear la implementación. El equipo puede cambiarla.
- **[Abierta P-n]**: hace falta una decisión del equipo antes de implementar.
  Todas están juntas en la [sección 8](#8-preguntas-abiertas).

---

## 1. Qué es StonksView

Una web app donde una persona carga las inversiones que tiene repartidas en
distintas plataformas (exchange cripto, wallet propia, broker, banco) y ve **un
solo patrimonio consolidado**. Lo que la diferencia de una planilla:

1. **Transferencia interna**: mover un activo de una plataforma propia a otra
   no es una venta. Se conserva el costo base y la fecha de compra originales.
2. **Ventas con costo real**: al vender se consumen los lotes por FIFO o LIFO y
   se calcula la ganancia realizada exacta.
3. **Insight con IA**: un texto que interpreta las métricas ya calculadas
   (por ejemplo, "62% de tu patrimonio está en una sola sede"). La IA nunca
   calcula ni inventa números.

Usuario objetivo: personas con inversiones en más de una plataforma que hoy
suman su patrimonio a mano.

---

## 2. Alcance

| Funcionalidad | Entra en el MVP | Issue |
|---|---|---|
| Registro e inicio de sesión | Sí | #16, #26 |
| Alta, edición y baja de tenencias | Sí | #18, #27 |
| Dashboard consolidado | Sí | #28, #31 |
| Transferencia interna | Sí | #19, #29 |
| Venta FIFO/LIFO | Sí (backend) — **falta issue de UI** | #15, #19 |
| Precios actuales | Sí | #34 |
| Insight con IA | Sí | #32, #33 |
| Alertas de precio con notificación push | Sí | #35 |
| Importación por CSV | Opcional | #37 |
| Historial de movimientos | **[Propuesta]** Sí, solo lectura — falta issue | — |
| Snapshots del patrimonio | No (la tabla existe, sin issue) | — |
| Seguimiento de noticias (`news_watches`) | No (la tabla existe, sin issue) | — |
| Gráfico de precio histórico (`price_history_cache`) | No (la tabla existe, sin issue) | — |
| Conexión automática con exchanges o bancos | No: la carga es manual o por CSV | — |

---

## 3. Conceptos

| Concepto | Qué es | En la base |
|---|---|---|
| **Usuario** | Cuenta de Supabase Auth (email y contraseña). | `auth.users` |
| **Portfolio** | Conjunto de inversiones de un usuario, con una moneda base (USD por defecto). | `portfolios` |
| **Sede** | Lugar donde está guardado un activo: "Binance", "Ledger", "IOL". Tiene nombre libre y tipo. | `holdings.source_name`, `holdings.source_type` |
| **Tipo de sede** | `exchange`, `wallet`, `broker` u `other`. | CHECK en `source_type` |
| **Clase de activo** | `crypto`, `stock`, `etf`, `cedear`, `forex` u `other`. | CHECK en `asset_class` |
| **Lote (tenencia)** | Una compra concreta: símbolo, cantidad, **costo por unidad**, fecha y sede. Un mismo activo puede tener varios lotes (BTC comprado a 30k y a 60k). | una fila de `holdings` |
| **Posición** | Todos los lotes de un mismo símbolo y clase, sumados. Es una vista; no se guarda. | — |
| **Movimiento** | Registro histórico: compra, venta, salida o entrada por transferencia. | `transactions` |
| **Transferencia** | Mover unidades de un lote a otra sede propia. No es venta. | `transfers` + función `transfer_holding` |
| **Venta** | Operación real de mercado: consume lotes y genera ganancia realizada. | `sales` + función `sell_holding` |
| **Insight** | Texto de la IA sobre las métricas del portfolio, con el contexto exacto que se le mandó. | `ai_insights` |
| **Alerta** | Aviso cuando un precio cruza un valor o varía un porcentaje. | `price_alerts` |

---

## 4. Reglas de negocio

### Cuenta y portfolio

- **RN-01.** Cada usuario solo ve y modifica sus propios datos. Lo garantiza RLS
  en la base, además de la validación en la API.
- **RN-02.** **[Propuesta]** Al registrarse se crea automáticamente un portfolio
  llamado "Mi portfolio" en USD. El MVP maneja **un portfolio por usuario**,
  aunque el schema permite varios. **[Abierta P-1]**
- **RN-03.** **[Propuesta]** La moneda base del portfolio es USD y no se puede
  cambiar en el MVP. **[Abierta P-2]**

### Tenencias

- **RN-04.** Un lote tiene: símbolo, clase de activo, cantidad (> 0), costo por
  unidad (≥ 0, opcional), sede (nombre y tipo), fecha de adquisición
  (opcional), comisión (≥ 0, opcional), fin de lockup (opcional), ratio (> 0,
  solo CEDEAR) y notas.
- **RN-05.** El **costo base es por unidad**, no total del lote. Se expresa en
  la moneda base del portfolio. **[Abierta P-3]**
- **RN-06.** **[Propuesta]** El símbolo se guarda en mayúsculas y sin espacios
  (`btc ` → `BTC`).
- **RN-07.** Las sedes se comparan sin distinguir mayúsculas ni espacios:
  "binance" y "Binance " son la misma sede. Se muestra el nombre tal como se
  cargó la primera vez. (Ya lo hace `transfer_holding`; el alta manual tiene
  que hacer lo mismo.)
- **RN-08.** **[Propuesta]** Al cargar un lote a mano se registra también un
  movimiento `buy` con precio igual al costo por unidad, para que el historial
  quede completo.
- **RN-09.** **[Propuesta]** Un lote se puede **editar** (todos los campos) y
  **borrar** solo si nunca participó de una transferencia ni de una venta. Si
  participó, se corrige con una venta o una transferencia, no editándolo: si no,
  el historial deja de cerrar. **[Abierta P-4]**
- **RN-10.** Los lotes nunca se promedian ni se fusionan si tienen distinto
  costo, fecha, ratio o lockup: rompería la ganancia realizada y el orden
  FIFO/LIFO.
- **RN-11.** Los bancos no tienen tipo de sede propio: el CHECK actual solo
  admite `exchange`, `wallet`, `broker` y `other`. **[Abierta P-5]**

### Valuación y métricas

- **RN-12.** Valor de un lote = cantidad × precio actual del símbolo. Para
  CEDEAR se usa el precio del propio CEDEAR. **[Abierta P-6]**
- **RN-13.** Patrimonio total = suma del valor de todos los lotes con precio.
- **RN-14.** Ganancia no realizada de un lote = (precio actual − costo por
  unidad) × cantidad. Los lotes sin costo base no entran en la ganancia y se
  marcan "sin costo base". La comisión no se suma al costo. **[Abierta P-7]**
- **RN-15.** **[Propuesta]** Un lote sin precio disponible se muestra con su
  cantidad y costo, con la etiqueta "sin precio", y queda **fuera** del
  patrimonio total. El dashboard avisa cuántos activos quedaron afuera. No hay
  precio manual en el MVP. **[Abierta P-8]**
- **RN-16.** Composición: porcentaje del patrimonio total por sede, por clase de
  activo y por activo.
- **RN-17.** Concentración de riesgo: se marca cuando una sede o un activo
  supera un umbral del patrimonio. **[Propuesta]** 50% para sede y 40% para
  activo. **[Abierta P-9]**
- **RN-18.** Todas las métricas las calcula el backend de forma determinística
  (#31). El frontend solo las muestra; la IA solo las interpreta.

### Precios

- **RN-19.** Los precios salen de APIs públicas: CoinGecko para cripto y Yahoo
  Finance para acciones, ETF y CEDEAR. Se cachean en `price_cache` con la
  fecha de consulta.
- **RN-20.** **[Propuesta]** Un precio se considera vigente por 5 minutos. Si
  venció, se pide de nuevo; si la API falla, se usa el último guardado y se
  muestra su antigüedad ("precio de hace 2 h"). **[Abierta P-10]**

### Transferencias

- **RN-21.** Una transferencia mueve unidades de **un lote** a otra sede del
  mismo portfolio. No genera venta ni cambia el costo por unidad, la fecha de
  adquisición, el ratio ni el lockup.
- **RN-22.** Transferencia total: el lote cambia de sede y conserva su
  identidad. Transferencia parcial: se descuenta del origen y en destino se
  suma a un lote idéntico si existe, o se crea uno nuevo.
- **RN-23.** No se puede transferir más de lo que tiene el lote, ni a la misma
  sede.
- **RN-24.** Cada transferencia queda en el historial como salida y entrada,
  sin precio.
- **RN-25.** No se cobra ni se registra comisión de red o de retiro.
  **[Abierta P-11]**
- **RN-26.** Un lote en lockup hoy **se puede** transferir (la función no lo
  bloquea). **[Abierta P-12]**

### Ventas

- **RN-27.** El usuario indica símbolo, cantidad, precio de venta, fecha y
  método (FIFO o LIFO). La venta consume lotes en ese orden según la fecha de
  adquisición.
- **RN-28.** Se calcula: ingreso = cantidad × precio de venta; costo = suma
  del costo de las unidades consumidas; ganancia realizada = ingreso − costo.
  Queda guardado qué lotes se consumieron y cuánto de cada uno.
- **RN-29.** **[Propuesta]** La venta consume solo lotes de **una sede** (se
  vende en un exchange o broker concreto). **[Abierta P-13]**
- **RN-30.** No se puede vender más de lo que hay en esa sede.

### Insight con IA

- **RN-31.** El insight se genera **a pedido** del usuario (botón), no
  automáticamente.
- **RN-32.** A la IA solo se le mandan métricas ya calculadas: montos,
  porcentajes y símbolos. Nunca el email, el nombre ni ningún dato que
  identifique al usuario.
- **RN-33.** El texto tiene que citar el dato de origen. La IA no puede
  devolver números que no estén en el contexto. **[Propuesta]** Se le indica
  en el prompt y se descarta la respuesta si menciona un porcentaje o monto que
  no está en el contexto.
- **RN-34.** Si la IA no responde a tiempo, falla o el usuario superó su límite
  diario, se muestra "Insight no disponible por ahora" y el resto del
  dashboard sigue funcionando. Se guarda igual con estado `no_disponible`.
- **RN-35.** **[Propuesta]** Límite de 5 insights por usuario por día y timeout
  de 10 s. **[Abierta P-14]**
- **RN-36.** **[Propuesta]** El insight no es un consejo de inversión, y la UI
  lo aclara con una leyenda fija.

### Alertas

- **RN-37.** Dos tipos: **por precio** (el precio sube por encima o baja por
  debajo de un valor) y **por variación** (el precio varía un porcentaje
  respecto del precio al crear la alerta).
- **RN-38.** Un proceso programado revisa las alertas activas. Si se cumple la
  condición, manda una notificación push a todos los navegadores suscriptos
  del usuario y registra cuándo se disparó.
- **RN-39.** **[Propuesta]** Una alerta se dispara **una sola vez** y queda
  inactiva. El usuario la puede reactivar. **[Abierta P-15]**
- **RN-40.** **[Propuesta]** El chequeo corre cada 15 minutos. **[Abierta P-16]**
- **RN-41.** Para recibir alertas el usuario tiene que dar permiso de
  notificaciones en el navegador. Sin permiso, la alerta se crea igual y la
  UI avisa que no va a llegar la notificación.
- **RN-42.** El chequeo es idempotente: una corrida que falla no duplica
  notificaciones.

### Importación por CSV (opcional)

- **RN-43.** **[Propuesta]** Columnas: `symbol, asset_class, quantity,
  cost_basis, source_type, source_name, acquired_at`. Cada fila crea un lote
  con las mismas validaciones que el alta manual.
- **RN-44.** **[Propuesta]** Es todo o nada: si una fila es inválida no se
  importa ninguna, y se muestra la lista de errores con número de línea.

---

## 5. Pantallas

Todas las pantallas salvo P1 requieren sesión. Sin sesión, redirigen a P1.

En todas las pantallas que cargan datos:
- **Cargando:** esqueleto del contenido, sin pantalla en blanco.
- **Error de red o del servidor:** mensaje "No pudimos cargar tus datos" con
  botón "Reintentar". No se muestra el detalle técnico.
- **Sesión vencida:** redirige a P1 y después de entrar vuelve a la pantalla
  donde estaba.

### P1. Ingreso y registro (#26)

- **Objetivo:** entrar a la app o crear una cuenta.
- **Contenido:** formulario con email y contraseña; alterna entre "Ingresar" y
  "Crear cuenta".
- **Validaciones:** email con formato válido; contraseña de al menos 8
  caracteres **[Propuesta]**.
- **Errores:** "Email o contraseña incorrectos" (sin decir cuál de los dos
  está mal); "Ya existe una cuenta con ese email".
- **Después de entrar:** va a P2 si no tiene tenencias, o a P3 si tiene.
- **[Abierta P-17]** ¿Se pide confirmar el email? ¿Hay "olvidé mi contraseña"?

### P2. Primeros pasos

- **Objetivo:** que un usuario nuevo cargue su primera tenencia.
- **Contenido:** explicación breve de qué hace la app y dos botones: "Cargar una
  tenencia" (P5) e "Importar CSV" (P10, si está implementado).
- **[Propuesta]** No es una pantalla aparte: es el estado vacío de P3.

### P3. Dashboard (#28, #31, #33)

- **Objetivo:** ver el patrimonio consolidado de un vistazo.
- **Contenido:**
  1. Patrimonio total en la moneda base y ganancia no realizada total (monto y
     porcentaje).
  2. Composición por sede y por clase de activo (gráfico de torta o barras y
     tabla con porcentajes).
  3. Aviso de concentración de riesgo si una sede o activo supera el umbral
     (RN-17).
  4. Tarjeta del insight (P3.1).
  5. Aviso "N activos sin precio no están incluidos en el total" si
     corresponde (RN-15).
  6. Fecha y hora de los precios usados.
- **Acciones:** ir a tenencias (P4), cargar tenencia (P5), transferir (P6),
  vender (P7).
- **Estado vacío:** P2.
- **Hecho cuando:** los números coinciden con la base (criterio de #28).

#### P3.1. Tarjeta del insight (#33)

- Muestra el último insight con su fecha, o "Todavía no generaste ningún
  insight".
- Botón "Generar insight". Mientras espera, muestra que está generando y
  deshabilita el botón.
- Si no está disponible (RN-34), lo dice sin romper el resto de la pantalla.
- Si alcanzó el límite diario: "Alcanzaste el límite de insights de hoy".
- Leyenda fija: "Generado por IA a partir de tus datos. No es un consejo de
  inversión."

### P4. Tenencias

- **Objetivo:** ver y administrar todo lo que tiene el usuario.
- **Contenido:** tabla agrupada por **posición** (símbolo + clase). Cada fila
  muestra cantidad total, valor, costo promedio ponderado **(solo para
  mostrar, no se guarda)**, ganancia no realizada y en cuántas sedes está. Al
  expandir una posición se ven sus lotes: sede, cantidad, costo por unidad,
  fecha, valor y ganancia.
- **Filtros:** por sede y por clase de activo.
- **Acciones por lote:** editar (P5), borrar (con confirmación; RN-09),
  transferir (P6 con el lote preseleccionado), vender (P7 con la sede
  preseleccionada).
- **Estado vacío:** igual que P2.

### P5. Alta y edición de tenencia (#27)

- **Objetivo:** cargar un lote a mano.
- **Campos:**

  | Campo | Obligatorio | Validación |
  |---|---|---|
  | Símbolo | Sí | Texto; se normaliza a mayúsculas (RN-06) |
  | Clase de activo | Sí | Lista: cripto, acción, ETF, CEDEAR, forex, otro |
  | Cantidad | Sí | Número > 0 |
  | Costo por unidad | No | Número ≥ 0. Ayuda: "precio que pagaste por cada unidad" |
  | Sede | Sí | Texto con autocompletado de las sedes ya usadas (RN-07) |
  | Tipo de sede | Sí | Lista: exchange, wallet, broker, otro. Se completa solo si la sede ya existe |
  | Fecha de adquisición | No | Fecha no futura |
  | Comisión | No | Número ≥ 0 |
  | Ratio | Solo CEDEAR | Número > 0. Ayuda: "cuántos CEDEAR equivalen a 1 acción" |
  | Fin de lockup | No | Fecha |
  | Notas | No | Texto |

- **Al guardar:** vuelve a P4 con el lote resaltado y el mensaje "Tenencia
  guardada".
- **Edición:** el mismo formulario precargado. Si el lote tiene transferencias
  o ventas, la edición no está disponible (RN-09).
- **Hecho cuando:** se crea y se ve la tenencia (criterio de #27).

### P6. Transferencia interna (#29)

- **Objetivo:** mover un activo entre dos sedes propias sin que cuente como
  venta.
- **Pasos:**
  1. Elegir activo y sede de origen.
  2. Si en esa sede hay más de un lote, elegir cuál (se muestran fecha, costo y
     cantidad de cada uno). Si hay uno solo, se elige solo.
  3. Cantidad, con botón "Todo".
  4. Sede destino: existente (lista) o nueva (nombre y tipo).
  5. Confirmación: "Vas a mover 0,5 BTC de Binance a Ledger. El costo base y
     la fecha de compra no cambian."
- **Validaciones:** RN-23. Los errores de la función (`Cantidad insuficiente`,
  `misma sede`) se muestran en español claro junto al campo correspondiente.
- **Al terminar:** vuelve a P4 con el mensaje "Transferencia registrada".
- **Hecho cuando:** transfiere sin afectar el costo base (criterio de #29).
- **[Abierta P-18]** ¿Se puede transferir una cantidad que abarque varios
  lotes de la misma sede en un solo paso? Hoy la función mueve un lote por
  vez.

### P7. Venta — **falta issue**

- **Objetivo:** registrar una venta real y ver la ganancia realizada.
- **Campos:** activo, sede (RN-29), cantidad, precio de venta por unidad,
  fecha de venta (por defecto hoy) y método FIFO o LIFO (por defecto FIFO
  **[Propuesta]**).
- **Vista previa antes de confirmar:** qué lotes se consumen y cuánto de cada
  uno, ingreso, costo y ganancia realizada.
- **Al terminar:** vuelve a P4 con el mensaje "Venta registrada: ganancia de
  USD X".

### P8. Historial de movimientos — **falta issue** **[Propuesta]**

- **Objetivo:** ver todo lo que pasó en el portfolio.
- **Contenido:** lista cronológica (más reciente arriba) de compras, ventas y
  transferencias. Cada fila muestra fecha, tipo, activo, cantidad, sedes y
  precio si corresponde. Las ventas se pueden expandir para ver los lotes
  consumidos y la ganancia realizada.
- **Filtros:** por tipo, activo y rango de fechas.
- **Solo lectura.**

### P9. Alertas (#35)

- **Objetivo:** recibir un aviso cuando un precio se mueve.
- **Contenido:** lista de alertas con activo, condición, estado (activa,
  disparada el día X, inactiva) y acciones (activar, desactivar, borrar).
- **Crear alerta:** activo (de los que tiene o cualquier símbolo
  **[Abierta P-19]**), tipo (por precio o por variación), valor objetivo
  (> 0) o porcentaje, y dirección (sube o baja).
- **Permiso de notificaciones:** si no está dado, banner con botón "Activar
  notificaciones" (RN-41).
- **Notificación:** "BTC superó USD 70.000 (precio actual USD 70.312)". Al
  tocarla abre P3.

### P10. Importar CSV (#37, opcional)

- **Objetivo:** cargar muchas tenencias de una vez.
- **Contenido:** link a un CSV de ejemplo, selector de archivo y vista previa
  de las primeras filas.
- **Resultado:** "Se importaron N tenencias" o la lista de errores por línea
  (RN-44).

### Navegación

Barra con: Dashboard (P3), Tenencias (P4), Movimientos (P8), Alertas (P9) y
menú de usuario (email y "Cerrar sesión"). Botón principal "Nueva tenencia"
siempre visible. **[Propuesta]** En el celular la barra pasa abajo.

---

## 6. Flujos de usuario

### F1. Primera vez

1. Se registra en P1.
2. Se crea su portfolio en USD (RN-02).
3. Ve el estado vacío del dashboard y carga su primera tenencia en P5.
4. Vuelve al dashboard y ve su patrimonio.

### F2. Mover cripto del exchange a una wallet

1. Desde P4 expande BTC y elige "Transferir" en el lote de Binance.
2. Indica 0,5 y la sede nueva "Ledger" de tipo wallet.
3. Confirma. En P4 ve 0,5 BTC en Binance y 0,5 en Ledger, los dos con el
   mismo costo y fecha que antes.
4. En el dashboard el patrimonio total no cambió; cambió la composición por
   sede.

### F3. Vender

1. Desde P4 elige "Vender" en una posición en Binance.
2. Carga cantidad, precio y método; revisa la vista previa.
3. Confirma. La cantidad baja, la venta aparece en P8 con su ganancia
   realizada.

### F4. Pedir un insight

1. En P3 toca "Generar insight".
2. El backend arma las métricas, se las manda a la IA y guarda el resultado.
3. Ve el texto, por ejemplo: "El 62% de tu patrimonio está en Binance: si esa
   plataforma tuviera un problema, afectaría a más de la mitad de tus
   inversiones."

### F5. Alerta de precio

1. En P9 crea "BTC por encima de USD 70.000" y activa las notificaciones.
2. Cuando el chequeo programado ve que se cumplió, le llega la notificación.
3. La alerta queda como disparada (RN-39).

---

## 7. Relación con las issues

| Issue | Partes de esta spec |
|---|---|
| #16, #26 | P1, RN-01, RN-02 |
| #18, #27 | P4, P5, RN-04 a RN-11 |
| #28 | P3, RN-13, RN-15, RN-16 |
| #31 | RN-12 a RN-18 |
| #19, #29 | P6, RN-21 a RN-26 |
| #15, #19 | P7, RN-27 a RN-30 |
| #34 | RN-19, RN-20 |
| #32, #33 | P3.1, RN-31 a RN-36 |
| #35 | P9, RN-37 a RN-42 |
| #37 | P10, RN-43, RN-44 |

Issues que faltan crear:

- **UI de venta (P7).** El backend está en #15 y #19, pero ninguna issue de la
  fase 3 cubre la pantalla.
- **Historial de movimientos (P8)**, si se acepta la propuesta.
- **Alta automática del portfolio al registrarse (RN-02)**, si no entra en #16.

---

## 8. Preguntas abiertas

| # | Pregunta | Propuesta | Afecta a |
|---|---|---|---|
| P-1 | ¿Un portfolio por usuario o varios? | Uno, creado al registrarse. | RN-02, #16, #18 |
| P-2 | ¿Se puede elegir la moneda base (USD, ARS)? | Solo USD en el MVP. | RN-03, #31 |
| P-3 | ¿En qué moneda carga el usuario el costo base de algo que compró en pesos (CEDEAR, acciones argentinas)? | En USD; el usuario hace la conversión al cargar. | RN-05, P5 |
| P-4 | ¿Se puede editar o borrar un lote que ya tuvo transferencias o ventas? | No. | RN-09, #18 |
| P-5 | ¿Se agrega el tipo de sede `bank`? El readme habla de bancos pero el CHECK no lo admite. | Sí, ampliando el CHECK en #13. | RN-11, #13 |
| P-6 | ¿Cómo se valúan los CEDEAR y el `forex`, que cotizan en pesos? ¿Con qué tipo de cambio? | Precio del CEDEAR en ARS convertido a USD con el dólar MEP de la misma fuente. | RN-12, #34 |
| P-7 | ¿La comisión de compra suma al costo para la ganancia? | No en el MVP. | RN-14, #31, #15 |
| P-8 | ¿Se permite cargar un precio a mano cuando no hay precio de mercado? (el readme lo menciona como plan B) | No en el MVP. | RN-15, #34 |
| P-9 | ¿Desde qué porcentaje hay concentración de riesgo? | 50% por sede, 40% por activo. | RN-17, #31 |
| P-10 | ¿Cada cuánto se refrescan los precios? | Vigencia de 5 minutos. | RN-20, #34 |
| P-11 | ¿Se registra la comisión de red o retiro de una transferencia? | No. | RN-25 |
| P-12 | ¿Se bloquea transferir o vender un lote en lockup? | Bloquear la venta y permitir la transferencia. | RN-26, #15, #19 |
| P-13 | ¿La venta FIFO/LIFO toma lotes de una sede o de todas? | De una sede. | RN-29, #15 |
| P-14 | ¿Cuántos insights por día y con qué timeout? | 5 por día, 10 s. | RN-35, #32 |
| P-15 | ¿La alerta se dispara una vez o cada vez que se cumple? | Una vez y queda inactiva. | RN-39, #35 |
| P-16 | ¿Cada cuánto corre el chequeo de alertas? | Cada 15 minutos. | RN-40, #35 |
| P-17 | ¿Confirmación de email y recuperación de contraseña? | Recuperación sí; confirmación según lo que permita el plan de Supabase. | P1, #26 |
| P-18 | ¿Transferencia de varios lotes en un paso? | No: un lote por vez. | P6, #29 |
| P-19 | ¿Alertas sobre activos que el usuario no tiene? | Sí. | P9, #35 |
