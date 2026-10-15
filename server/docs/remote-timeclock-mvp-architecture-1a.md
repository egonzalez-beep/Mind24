# Reloj Checador Remoto — Fase 1A / 1A.1 (auditoría + arquitectura MVP)

**Estado:** diseño only — sin implementación, sin migración.  
**Fecha:** 2026-10-13  
**1A.1:** separación jornada vs señal web, token en fragmento, auditoría admin, idempotencia.

---

## 1. Arquitectura actual relevante (Mind24)

| Pieza | Hallazgo |
|-------|----------|
| **Stack** | Node/Express, Prisma, PostgreSQL, sesiones `express-session` + `connect-pg-simple` (`session`). |
| **Multi-tenant** | `Organization`; admins `empresa_admin` en `/api/org/*`. |
| **Candidatos** | `Candidate` + `User` + login; código 5 dígitos derivado — **no reutilizar** para checador. |
| **Frontend** | Monolito `index.html`; vistas SPA admin/candidato. |
| **Rutas HTTP** | Solo `/` y `/login` sirven SPA hoy. |
| **Rate limit** | ~200 req/min/IP en `/api`. |

**Conclusión:** dominio nuevo **`WorkforceEmployee`**, auth de checador **independiente** de candidato/admin.

---

## 2. Principio rector (1A.1)

**El heartbeat mide comunicación con el navegador que tiene abierta la página del checador, no actividad laboral ni productividad.**

Ejemplo válido: entrada registrada → empleado trabaja en Excel/CRM → pestaña Mind24 abierta sin clics → **no** es “inactivo laboralmente”; solo puede mostrarse señal web (`BACKGROUND` / `NO_SIGNAL`).

---

## 3. Estados finales

### A. Estado de jornada (`ShiftLifecycle` — fuente de verdad server)

| Valor | Significado |
|-------|-------------|
| `OFF_DUTY` | Sin sesión con `status = open`. |
| `SHIFT_OPEN` | Hay sesión abierta (`checkOutAt` null). **La jornada sigue hasta checkout o cierre admin.** |
| `SHIFT_COMPLETED` | Checkout empleado o cierre admin con `checkOutAt` definido. |
| `OPEN_ANOMALY` | `SHIFT_OPEN` + regla de negocio (ej. >16 h sin checkout) — flag para admin, **sin** auto-cierre en MVP. |

La duración laboral registrada en MVP = **`checkOutAt - checkInAt`** (server UTC), no suma de heartbeats.

### B. Estado de señal web (`WebSignal` — derivado, telemetría)

Calculado en servidor a partir de `lastHeartbeatAt` + último `visibility` reportado en heartbeat (solo mientras `SHIFT_OPEN`):

| Valor | Regla MVP | Copy UI empleado/admin |
|-------|-----------|-------------------------|
| `CONNECTED` | `now - lastHeartbeatAt < 3 min` y último visibility ≠ hidden prolongado | **Con señal reciente** |
| `BACKGROUND` | Heartbeat reciente (< 3 min) y `document.hidden` / visibility hidden en último HB | **Página en segundo plano** |
| `NO_SIGNAL` | `now - lastHeartbeatAt ≥ 3 min` | **Sin señal reciente** |

Prioridad al evaluar en un instante: si no hay HB reciente → `NO_SIGNAL`; si hay HB reciente y hidden → `BACKGROUND`; si no → `CONNECTED`.

**`NO_SIGNAL` no cierra la jornada ni resta tiempo trabajado.**

### Caso celular (obligatorio)

Entrada desde móvil → bloqueo de pantalla / app en segundo plano → trabajo en laptop:

- Jornada = **`SHIFT_OPEN`** (hasta salida explícita).
- Señal web = **`NO_SIGNAL`** (normal y esperado).
- **Prohibido** en MVP: auto-checkout, auto-descuento de duración, o marcar jornada como terminada por falta de heartbeat.

---

## 4. Modelo Prisma revisado (1B)

### Enums

```prisma
enum WorkforceEmployeeStatus {
  active
  inactive
}

enum RemoteWorkSessionStatus {
  open
  completed
  admin_closed
}

enum WebSignal {
  connected
  background
  no_signal
}

enum RemoteWorkEventType {
  CHECK_IN
  CHECK_OUT
  HEARTBEAT
  WEB_SIGNAL_CHANGED      // CONNECTED | BACKGROUND | NO_SIGNAL (transición)
  TAB_VISIBLE
  TAB_HIDDEN
  SIGNAL_LOST             // opcional: transición a NO_SIGNAL (evento, no cierre)
  SIGNAL_RESUMED
  ADMIN_CLOSE
  ADMIN_ADJUSTMENT
  TOKEN_REGENERATED
}
```

### Campos eliminados vs 1A inicial

| Eliminado | Motivo |
|-----------|--------|
| `activeSeconds`, `idleSeconds`, `awaySeconds`, `disconnectedSeconds` | No son métricas laborales; riesgo de interpretación como productividad. |
| `RemoteWorkPresence` (online/idle/away/disconnected laboral) | Sustituido por `WebSignal`. |
| Eventos `PRESENCE_IDLE`, `PRESENCE_ONLINE`, etc. | Sustituidos por señal web. |

### Campos conservados / añadidos

**`WorkforceEmployee`** — sin cambio conceptual (`accessTokenHash`, `tokenVersion`, timezone, org).

**`RemoteWorkSession`**

| Campo | Uso |
|-------|-----|
| `checkInAt`, `checkOutAt` | Timestamps oficiales (solo servidor en escritura). |
| `status` | `open` \| `completed` \| `admin_closed`. |
| `lastHeartbeatAt` | Última señal recibida. |
| `lastWebSignal` | `WebSignal` cacheado. |
| `anomalyFlag` | OPEN_ANOMALY visible admin. |
| `clientTabId` | Coordinación multi-pestaña (opcional MVP). |
| `userAgent`, `deviceClass` | Metadata no invasiva. |
| **Cierre admin** | `closedByUserId`, `closedAt`, `closeReason` (texto obligatorio). |
| **Ajuste horarios** | `adjustedByUserId`, `adjustedAt`, `adjustmentReason`; snapshots en evento (ver abajo). |

**Duración:** no columna obligatoria; API expone `workedDurationSec = checkOutAt - checkInAt` cuando hay checkout.

**Telemetría opcional (fase 1D+, no laboral):** si se guarda interacción en página, nombrar `pageLastInteractionAt` y documentar “interacción con la página del checador”, **sin** acumular “segundos activos laborales” en MVP.

**`RemoteWorkEvent`**

- Transiciones: CHECK_IN/OUT, WEB_SIGNAL_CHANGED, TAB_*, ADMIN_*.
- **`ADMIN_ADJUSTMENT` payload obligatorio:** `{ before: { checkInAt, checkOutAt }, after: { ... }, reason, adjustedByUserId }`.
- **`ADMIN_CLOSE` payload:** `{ checkOutAt, reason, closedByUserId }`.
- HEARTBEAT: no persistir cada 45 s en MVP (solo actualizar fila sesión); opcional evento agregado cada 15 min si auditoría lo exige.

**`RemoteWorkSessionAdjustment`** (opcional tabla dedicada 1B; mínimo viable = solo eventos):

Si se prefiere consultas simples, tabla hija con historial de patches; si no, solo `RemoteWorkEvent` ADMIN_ADJUSTMENT es suficiente para auditoría.

---

## 5. Flujo seguro del token (preferido 1A.1)

**Link entregado al admin (copiar):**

`https://mind24.mx/checador#<TOKEN_BASE64URL>`

El fragmento **`#...` no se envía al servidor** en la petición HTTP inicial → no aparece en access logs de proxy/Railway.

### Flujo

1. `GET /checador` → `sendFile(index.html)` (añadir ruta en `app.js`, **sin** token en path).
2. SPA vista `view-timeclock`: lee `location.hash.slice(1)`, valida formato.
3. **`POST /api/timeclock/public/exchange`** body `{ token }` (JSON, HTTPS).
4. Servidor: SHA-256(token) → lookup `WorkforceEmployee`; valida activo + org no bloqueada + `tokenVersion`.
5. Crea **sesión de checador** (cookie separada, ver abajo); **no** reutiliza sesión candidato/admin.
6. Cliente: `history.replaceState(null, '', '/checador')` — elimina token del historial visible.
7. APIs siguientes: **cookie de sesión checador** (`requireTimeclockSession`), **sin** reenviar token en cada request.

### Cookie de sesión checador

| Opción | Recomendación |
|--------|----------------|
| Misma `express-session` store, cookie distinta | **`name: 'mind24.tc.sid'`**, payload `{ workforceEmployeeId, organizationId, tokenVersion }`, `httpOnly`, `sameSite: 'lax'`, `maxAge` acorde a jornada (ej. 24 h rolling) o fin de shift + buffer. |
| Bearer en header tras exchange | Viable pero más exposición en devtools; cookie httpOnly preferida post-exchange. |

**Regenerar token:** invalida `tokenVersion`; sesiones checador existentes deben rechazarse si `session.tokenVersion !== employee.tokenVersion`.

**Alternativa equivalente:** `POST /exchange` devuelve token opaco de sesión de un solo uso en memoria/Redis — añade infra; **cookie + PG session store** reutiliza patrón Mind24.

**No usar:** `GET /checador/:token` (token en path logs), `?token=` en query (Referer/logs).

Encaja con SPA actual: nueva vista + bootstrap en load de `/checador`; no conflicto con `VIEWS` admin.

---

## 6. Endpoints revisados

### Público (post-exchange: cookie; exchange: body token once)

| Método | Ruta | Idempotencia |
|--------|------|----------------|
| POST | `/api/timeclock/public/exchange` | N/A (nuevo session) |
| GET | `/api/timeclock/public/me` | — |
| POST | `/api/timeclock/public/check-in` | Ver §9 |
| POST | `/api/timeclock/public/heartbeat` | Actualiza `lastHeartbeatAt`, `lastWebSignal` |
| POST | `/api/timeclock/public/check-out` | Ver §9 |

Heartbeat body mínimo: `{ tabId, visibility: 'visible'|'hidden' }` — **sin** afirmar productividad.

### Admin (`/api/org/timeclock/...`)

- CRUD empleados, regenerar token (solo hash nuevo + version++).
- `GET /dashboard/today` — columnas: jornada + **señal web** (no “activo laboral”).
- `POST /sessions/:id/admin-close` — `checkOutAt`, `closeReason` obligatorio → evento `ADMIN_CLOSE`.
- `POST /sessions/:id/admin-adjust` — cambio explícito check-in/out → evento `ADMIN_ADJUSTMENT` + campos audit.

---

## 7. Estrategia heartbeat

| Parámetro | Valor |
|-----------|--------|
| Intervalo cliente | **45 s** (rango aceptable 45–60 s) |
| CONNECTED | `lastHeartbeatAt` < **3 min** y visibility visible |
| BACKGROUND | HB < 3 min y visibility hidden |
| NO_SIGNAL | sin HB ≥ **3 min** |

Heartbeat **no modifica** `checkInAt`/`checkOutAt` ni “duración trabajada” en vuelo.

Eventos `SIGNAL_LOST` / `SIGNAL_RESUMED` opcionales al cruzar umbrales (transición), no cada tick.

---

## 8. Auditoría de correcciones administrativas

Toda edición de horarios:

1. Requiere `adjustmentReason` (o `closeReason`) no vacío.
2. Persiste `adjustedByUserId` / `closedByUserId` + `adjustedAt` / `closedAt`.
3. Emite `RemoteWorkEvent` `ADMIN_ADJUSTMENT` o `ADMIN_CLOSE` con **valores anteriores** en JSON.
4. UI admin muestra historial de incidencias / ajustes (lectura de eventos).

**Prohibido:** UPDATE silencioso de `checkInAt`/`checkOutAt` sin evento.

---

## 9. Idempotencia y red

Header opcional: **`Idempotency-Key`** (UUID) en check-in/out; mínimo viable sin header:

### CHECK_IN

- Si ya existe sesión `open` para el empleado → **200** con la misma sesión (no segunda jornada).
- Transacción serializable / unique partial index `(employeeId) WHERE status = 'open'`.
- Doble click: segundo request devuelve la sesión existente.

### CHECK_OUT

- Si sesión ya `completed`/`admin_closed` → **200** con estado final (retry seguro).
- Si no hay sesión open → 409 con mensaje claro.

### Heartbeat

- Sin efecto destructivo; ignorar si sesión ya cerrada (204 o 200 noop).

Timeouts móviles: cliente reintenta checkout con misma clave → respuesta idempotente.

---

## 10. Arquitectura final (diagrama)

```
Organization
  └── WorkforceEmployee (accessTokenHash, tokenVersion)
        └── RemoteWorkSession (checkIn/Out, status, lastHeartbeatAt, lastWebSignal)
              └── RemoteWorkEvent (audit + transiciones)

Empleado:  /checador#TOKEN → exchange → cookie mind24.tc.sid → check-in/out + HB
Admin:     session mind24.sid (empresa_admin) → /api/org/timeclock/*
```

---

## 11. UI copy (referencia)

| Señal web | Admin / empleado |
|-----------|------------------|
| CONNECTED | Con señal reciente |
| BACKGROUND | Página en segundo plano |
| NO_SIGNAL | Sin señal reciente |

Jornada: Fuera de jornada | **Jornada en curso** | Jornada finalizada | Revisión requerida (anomalía).

---

## 12. Privacidad (sin cambio)

Aviso en pantalla empleado: horarios de entrada/salida, estado de **conexión con esta página** y visibilidad de pestaña — **no** monitoreo de otras apps ni productividad.

---

## 13. Estimación de carga (sin contadores por HB)

~640 POST heartbeat/día/empleado (8 h, 45 s) + writes ligeros en fila sesión — similar a 1A; menos eventos si no se loguea cada HB.

---

## 14. Roadmap hacia 1B

| Fase | Entregable |
|------|------------|
| **1A / 1A.1** | Este documento ✓ |
| **1B** | Schema Prisma (modelo §4), migración, `exchange` + cookie checador, servicios base |
| **1C** | `GET /checador` + UI empleado check-in/out |
| **1D** | Heartbeat + WebSignal (sin métricas laborales) |
| **1E** | Dashboard admin HOY |
| **1F** | Historial + admin close/adjust auditado |
| **1G** | QA + idempotencia + rate limits |
| **1H** | Reportes |

---

## 15. Archivos probables (1B+)

- `server/prisma/schema.prisma`
- `server/src/routes/timeclock.public.routes.js`
- `server/src/routes/timeclock.org.routes.js`
- `server/src/services/timeclock*.service.js`
- `server/src/middleware/timeclockSession.middleware.js`
- `server/src/app.js` (`GET /checador`)
- `index.html` (`view-timeclock`, `view-dash-asistencia`)
- `server/scripts/test-timeclock-*.mjs`

---

## 16. Riesgos (actualizados)

| Riesgo | Mitigación |
|--------|------------|
| Interpretar NO_SIGNAL como falta laboral | Copy + jornada SHIFT_OPEN independiente; política RH externa. |
| Token en logs | Fragmento hash + exchange POST + replaceState. |
| Dos jornadas abiertas | Unique + check-in idempotente. |
| Confundir con candidato evaluación | Entidad y cookie separadas. |
