# Prueba de resiliencia con el LLM caído

Tarea 4.6 (issue #36). Requisito de la arquitectura: *"si la API del LLM no
responde, el endpoint de insight devuelve un estado explícito («no
disponible») sin romper el resto del dashboard, que es 100 % determinístico"*
(spec RN-34).

## Qué se garantiza

Ante cualquier falla de Groq:

1. `POST /portfolios/{id}/insights` responde **201** con `state: "no_disponible"` y `text: null`. Nunca devuelve 5xx por culpa de la IA.
2. No espera más que el timeout del cliente (10 s en producción).
3. El intento queda guardado en `ai_insights` con estado `no_disponible` y el contexto que se iba a mandar, para auditar.
4. `GET /portfolios/{id}/metrics` (el dashboard) sigue respondiendo **200** con los mismos números: el cálculo no pasa por la IA.
5. En el frontend, la tarjeta del insight muestra "Insight no disponible por ahora" sin afectar el resto de la pantalla (tarea 4.3).

## Evidencia automatizada

`backend/src/handlers/resilience.test.ts` ejecuta los handlers reales de las Lambdas de insight y de métricas, con Groq simulado. Hay un caso de control y una falla distinta por caso:

| Caso | Cómo se simula | Insight | Dashboard |
|---|---|---|---|
| Control (IA andando) | Groq responde un texto válido | `ok` | 200 |
| Sin API key configurada | `GROQ_API_KEY` vacía | `no_disponible` | 200 |
| Sin red | `fetch` falla con `TypeError` | `no_disponible` | 200 |
| Groq no responde | `fetch` nunca contesta; vence el timeout | `no_disponible` | 200 |
| Groq con error interno | HTTP 500 | `no_disponible` | 200 |
| Servicio caído | HTTP 503 | `no_disponible` | 200 |
| API key inválida | HTTP 401 | `no_disponible` | 200 |
| Respuesta vacía | `content: ""` | `no_disponible` | 200 |
| Número inventado (RN-33) | "Tu patrimonio creció un 15 %." | `no_disponible` | 200 |

En cada caso de falla se verifica además que el insight se guardó con estado `no_disponible` y que el dashboard devuelve el mismo patrimonio (96.000) y la misma ganancia no realizada (36.000) que en el caso de control. En el test, el timeout se acorta a 50 ms para no esperar los 10 s reales.

Para correrlo:

```bash
cd backend && npm test -- resilience
```

Salida del 27/11/2026:

```
✓ control: con la IA andando, el insight sale ok 15ms
✓ sin API key configurada: el insight queda no_disponible y el dashboard sigue andando 1ms
✓ sin red (falla la conexión): el insight queda no_disponible y el dashboard sigue andando 2ms
✓ Groq no responde (timeout): el insight queda no_disponible y el dashboard sigue andando 51ms
✓ Groq responde 500: el insight queda no_disponible y el dashboard sigue andando 1ms
✓ Groq responde 503 (servicio caído): el insight queda no_disponible y el dashboard sigue andando 0ms
✓ API key inválida (401): el insight queda no_disponible y el dashboard sigue andando 0ms
✓ respuesta vacía: el insight queda no_disponible y el dashboard sigue andando 0ms
✓ respuesta con un número inventado: el insight queda no_disponible y el dashboard sigue andando 0ms
Tests  9 passed (9)
```

El caso del timeout tarda 51 ms con un timeout de 50 ms: el pedido se corta apenas vence, no queda esperando a Groq.

## Demo en vivo para la defensa

Con la app local (`node scripts/setup-env.mjs`, `npm run dev` en `backend/` y `pnpm dev` en `frontend/`):

1. **Con la IA andando:** agregar `GROQ_API_KEY` válida al `.env` de la raíz, levantar la API, entrar al dashboard y tocar "Generar insight". Aparece el texto.
2. **Tirar la IA:** cambiar `GROQ_API_KEY` por un valor inválido (o cortar la red de la máquina) y reiniciar la API.
3. Tocar "Generar insight" otra vez: la tarjeta muestra "Insight no disponible por ahora" y el patrimonio, la ganancia y la composición por sede siguen iguales.
4. Mostrar el log de la API (`POST /portfolios/{portfolioId}/insights` con status 201) y, en Supabase, la fila nueva de `ai_insights` con `estado = 'no_disponible'`.

En AWS se hace lo mismo cambiando el secret `GROQ_API_KEY` del environment `production` por uno inválido y volviendo a desplegar. El intento queda en CloudWatch, en el dashboard `stonksview-api`, en la tabla de últimos requests.
