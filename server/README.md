# Mind24 — servidor MVP (Express + PostgreSQL + Prisma)

## Requisitos

- Node.js 20+
- PostgreSQL (Railway u otro proveedor)

## Variables de entorno

Copia `server/.env.example` a `server/.env` y define al menos:

- `DATABASE_URL` — cadena PostgreSQL (Railway la inyecta automáticamente al vincular el plugin Postgres).
- `SESSION_SECRET` — cadena larga y aleatoria en producción.

Opcional:

- `CLIENT_ORIGINS` — orígenes separados por coma si el front se sirve en otro dominio (CORS con credenciales).
- `TRUST_PROXY=1` — si el servicio está detrás de proxy (por defecto se confía en `X-Forwarded-*` en `NODE_ENV=production`).
- **Superadmin (panel en la web):** `SUPERADMIN_EMAIL` (único correo permitido) y `SUPERADMIN_PASSWORD_HASH` (bcrypt cost 12). Si no defines el hash, el servidor usa el valor por defecto en `src/config/env.js` (contraseña **`mind24`**). El superadmin **no** es un usuario en base de datos; la sesión es cookie httpOnly en `/api/superadmin/*`. Login solo: **`POST /api/superadmin/login`** (no uses `/api/auth/login`).

## Comandos

```bash
cd server
npm install
npx prisma migrate deploy
npm run db:seed
npm start
```

Desarrollo con recarga:

```bash
npm run dev
```

La app sirve el `index.html` del **repositorio padre** (raíz del proyecto) y la API bajo `/api/*` en el **mismo origen** (cookies de sesión).

**Importante:** abre siempre **`http://localhost:3000`** (o el `PORT` que uses). Si abres `index.html` con doble clic (`file://`) o solo un servidor estático (p. ej. Live Server en otro puerto), las llamadas a `/api/...` devolverán **HTTP 404** y no podrás iniciar sesión (ni como superadmin ni como empresa).

## Railway (producción)

### Servicio Node

1. En **Settings → Root Directory** del servicio Node, pon **`server`** (el `package.json` del backend está ahí; la raíz del repo no tiene otro `package.json`).
2. **Build**: Nixpacks ejecutará `npm install` (dispara `postinstall` → `prisma generate`). No hace falta Dockerfile.
3. **Deploy / Start**: usa `server/railway.json` o el script `npm start` del `package.json`:
   - `npx prisma migrate deploy && node src/server.js`  
   Así se aplican migraciones en cada arranque y luego levanta Express (escucha `process.env.PORT` que Railway inyecta).
4. **Frontend (`index.html`)**: con *Root Directory* = `server`, el build a veces **no incluye** el directorio padre del repo. El `postinstall` ejecuta `scripts/sync-index-html.mjs` (copia `../index.html` → `server/public/index.html` cuando existe). En el repo se versiona **`server/public/index.html`** como respaldo para Railway; tras editar el `index.html` de la raíz, ejecuta `npm install` en `server` o `node scripts/sync-index-html.mjs` y commitea `public/index.html` si cambió. Opcional: variable **`FRONTEND_INDEX_PATH`** (ruta absoluta al HTML).

### Variables de entorno (servicio Node)

| Variable | Obligatoria | Notas |
|----------|-------------|--------|
| `DATABASE_URL` | Sí | Referencia al plugin Postgres de Railway (suele inyectarse al vincular el servicio). La URL `*.railway.internal` es correcta para tráfico entre servicios en la misma red. |
| `SESSION_SECRET` | Sí en producción | Cadena larga y aleatoria (`openssl rand -hex 32`). Sin esto el arranque falla si `NODE_ENV=production`. |
| `NODE_ENV` | Recomendada | `production` (cookies `Secure`, `trust proxy`, etc.). |
| `PORT` | No | Railway la define sola; el código usa `process.env.PORT \|\| 3000`. |
| `SUPERADMIN_EMAIL` | Opcional | Por defecto `e.gonzalez@talento24.com` en código. |
| `SUPERADMIN_PASSWORD_HASH` | Opcional | bcrypt cost 12 de la contraseña del superadmin. Para la contraseña **`mind24`** pega exactamente: `$2a$12$fGvhXXwhWGjnpMIVR3et1uBjQ9akeFMNqKw9B4OWVhjEBqC00vE.y` |
| `CLIENT_ORIGINS` | Opcional | Solo si el HTML se sirve desde otro dominio que no sea el del API (CORS con credenciales). Mismo dominio Railway → déjalo vacío. |
| `TRUST_PROXY` | Opcional | En producción ya se confía en proxy por defecto; puedes forzar `1`. |

### Postgres

- La tabla **`session`** se crea con la migración inicial de Prisma (`20260214150000_init`); `connect-pg-simple` usa esa tabla (`createTableIfMissing: false`).
- **Bootstrap automático** al arrancar (`runBootstrapUsers`): si no existen los usuarios demo con correos `admin@demo.mind24.com` y `candidato@demo.mind24.com`, crea org (slug `mind24-bootstrap-demo`), definición de evaluación si falta, candidato, asignación pendiente. Idempotente (no borra ni duplica por email). Logs: `Bootstrap users created` o `Bootstrap users already exist`.
- **Seed manual** (`npm run db:seed`) sigue disponible; borra y recrea datos demo (no usar en producción salvo que quieras resetear).

### URLs a probar

Sustituye `TU_DOMINIO` por el hostname público del servicio (p. ej. `mind24-production.up.railway.app`):

- `https://TU_DOMINIO/api/health` → JSON `{ "ok": true, "db": "up" }` si Postgres responde.
- `https://TU_DOMINIO/` → `index.html` (mismo origen que `/api/*`, cookies de sesión válidas).

### Qué queda operativo tras el deploy

- API bajo `/api/*`, UI en `/`, Prisma + PostgreSQL, sesiones en tabla `session`, login auth y superadmin, mismas rutas que en local.
- CRUD de empresas (superadmin), org/candidatos/asignaciones/evaluaciones (según roles) tras migraciones; cuentas demo `*.mind24.com` las crea el **bootstrap** en el primer arranque.

## Cuentas de demostración (bootstrap en producción)

Si al arrancar no existían `admin@demo.mind24.com` y `candidato@demo.mind24.com`, el servidor los crea (org slug `mind24-bootstrap-demo`). Credenciales:

| Rol | Email | Contraseña |
|-----|--------|--------------|
| empresa_admin | admin@demo.mind24.com | Admin123 |
| candidato | candidato@demo.mind24.com | Candidato123 |

**Superadmin** (panel «Administrador general»): no es fila en `User`. Solo **`POST /api/superadmin/login`** + cookie; luego el front valida con **`GET /api/superadmin/me`**. Variables: `SUPERADMIN_EMAIL` (por defecto `e.gonzalez@talento24.com`) y `SUPERADMIN_PASSWORD_HASH` (para contraseña `mind24` usa el hash documentado en la tabla de variables de Railway arriba).

El comando `npm run db:seed` crea cuentas `@demo.mind24.local` y **borra** datos existentes; úsalo solo en desarrollo.

Cambia contraseñas en producción si expusiste estas cuentas.

## API (resumen)

- `GET /api/health`
- `POST /api/auth/login` — body `{ "email", "password" }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- **Superadmin (sesión aparte, `req.session.superAdmin`):** `POST /api/superadmin/login`, `POST /api/superadmin/logout`, `GET /api/superadmin/me`, y con sesión válida: organizaciones, créditos, evaluaciones globales, etc. (ver `src/routes/superadmin.routes.js`).
- **empresa_admin:** `GET/POST /api/org/candidates`, `GET /api/org/assessment-definitions`, `GET/POST /api/org/assignments`
- **candidato:** `GET /api/me/assignments`, `POST /api/me/assignments/:id/start`, `POST /api/me/attempts/:id/submit`, `GET /api/me/attempts/:id/result`

Motor psicométrico: definiciones en JSON (`AssessmentDefinition.config`); el cálculo se hace solo en servidor al enviar el intento.
