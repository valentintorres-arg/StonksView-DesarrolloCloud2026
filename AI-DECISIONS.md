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

## 16/11/2026 — Credenciales de deploy a AWS sin OIDC (tarea 0.3)
- **Problema abordado:** Configurar la cuenta de AWS para que GitHub Actions pueda desplegar (tarea 0.3). El plan original usaba un rol IAM con OIDC para evitar access keys, pero al intentarlo se encontró que la cuenta está en el plan free de AWS, cuya SCP de organización (administrada por AWS) niega explícitamente todas las acciones `iam:*OpenIDConnectProvider*`. Editar esa SCP requiere pasar la cuenta a plan pago.
- **Prompt / Herramienta utilizada:** Claude Code, con acceso de lectura a la cuenta por AWS CLI. Se le pidió revisar el estado de la tarea 0.3, diagnosticar el bloqueo y proponer alternativas.
- **Código / Arquitectura generada:** La IA diagnosticó el origen del bloqueo (SCP de la organización del plan free, roles `/managed/` de AWS) y comparó cuatro caminos: hacer el upgrade para editar la SCP, usar un usuario IAM con access keys, hacer el deploy manual o pasar al Plan B (Vercel). Con el camino elegido creó un budget mensual de USD 10 (avisos al 50/80/100% real y 100% pronosticado, midiendo gasto bruto sin créditos), el usuario `github-actions-deploy` con una policy de mínimo privilegio (`StonksViewGitHubDeploy`, acotada a recursos `stonksview-*` en us-east-2) y adaptó `deploy.yml` para usar las access keys desde los secrets del environment `production`.
- **Validación y Corrección Humana:** Se descartó, por ahora, el upgrade a plan pago (implica que el gasto por encima de los créditos se cobre a la tarjeta). Antes de elegir el camino de access keys se pidió verificarlo con una prueba reversible: crear y borrar un usuario y una access key de prueba. La policy se validó con IAM Access Analyzer (la primera versión tenía ARNs mal formados por la expansión de variables del shell y se corrigió). Para cerrar la escalada de privilegios se limitó `iam:PassRole` a Lambda y `iam:AttachRolePolicy` a `AWSLambdaBasicExecutionRole`. Queda como riesgo aceptado `iam:PutRolePolicy` sobre roles `stonksview-*`. Las access keys las genera y carga un integrante del equipo directamente en GitHub, sin pasar por la IA. También se evaluó volver al Plan B (Vercel + Supabase); se decidió seguir con AWS.
