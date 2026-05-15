# Mind24 — servidor MVP (Express + PostgreSQL + Prisma)

## Requisitos

- Node.js 20+
- PostgreSQL (Railway u otro proveedor)

## Variables de entorno

Copia `server/.env.example` a `server/.env` y define al menos:

- `DATABASE_URL` — cadena PostgreSQL (Railway la inyecta al vincular Postgres).
- `SESSION_SECRET` — cadena larga y aleatoria en cualquier entorno (`openssl rand -hex 32`).
- `PLATFORM_ADMIN_EMAIL` — correo del administrador de plataforma (`master_admin`). En cada arranque el bootstrap **sincroniza** ese usuario: fuerza `role = master_admin` y `organizationId = null` si hace falta. Si `PLATFORM_ADMIN_PASSWORD` está definida y no coincide con el hash guardado, actualiza la contraseña. Si el usuario **no existe** y la contraseña está vacía o ausente, no se crea (debes definir `PLATFORM_ADMIN_PASSWORD` para el alta inicial).

Opcional:

- `BOOTSTRAP_DEMO_ADMIN_EMAIL`, `BOOTSTRAP_DEMO_ADMIN_PASSWORD`, `BOOTSTRAP_DEMO_CANDIDATE_EMAIL`, `BOOTSTRAP_DEMO_CANDIDATE_PASSWORD` — si las **cuatro** están definidas y no vacías, el bootstrap crea (si faltan) la org demo interna, admin empresa, candidato y asignación. Si falta alguna, se omite por completo el bloque demo (solo aplica el bootstrap de plataforma según las vars anteriores).
- `CLIENT_ORIGINS` — orígenes separados por coma si el front se sirve en otro dominio (CORS con credenciales).
- `TRUST_PROXY=1` — si el servicio está detrás de proxy (por defecto se confía en `X-Forwarded-*` en `NODE_ENV=production`).

## Comandos

```bash
cd server
npm install
npx prisma migrate deploy
```

Para **seed destructivo** (`npm run db:seed`), define en `server/.env` las variables `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_CANDIDATE_EMAIL`, `SEED_CANDIDATE_PASSWORD` (y opcionalmente `SEED_ORG_SLUG`, por defecto `demo`). El seed **borra** datos existentes de las tablas implicadas; úsalo solo en desarrollo o cuando quieras resetear a propósito.

```bash
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
| `SESSION_SECRET` | Sí | Cadena larga y aleatoria (`openssl rand -hex 32`). El servidor la exige en todos los entornos. |
| `PLATFORM_ADMIN_EMAIL` | Recomendada si usas bootstrap de plataforma | Identifica al usuario que debe ser `master_admin` (creación o corrección en cada arranque). |
| `PLATFORM_ADMIN_PASSWORD` | Condicional | Obligatoria para **crear** el usuario si no existe. Si existe, se usa para **actualizar** el hash solo cuando difiere de la contraseña actual; si está vacía, el bootstrap puede igualmente corregir rol/org sin tocar la contraseña. |
| `BOOTSTRAP_DEMO_*` (cuatro vars) | No | Solo si quieres usuarios demo automáticos al arrancar; ver arriba. |
| `NODE_ENV` | Recomendada | `production` (cookies `Secure`, `trust proxy`, etc.). |
| `PORT` | No | Railway la define sola; el código usa `process.env.PORT \|\| 3000`. |
| `CLIENT_ORIGINS` | Opcional | Solo si el HTML se sirve desde otro dominio que no sea el del API (CORS con credenciales). Mismo dominio Railway → déjalo vacío. |
| `TRUST_PROXY` | Opcional | En producción ya se confía en proxy por defecto; puedes forzar `1`. |

### Postgres

- La tabla **`session`** se crea con la migración inicial de Prisma (`20260214150000_init`); `connect-pg-simple` usa esa tabla (`createTableIfMissing: false`).
- **Bootstrap al arrancar** (`runBootstrapUsers`): sincroniza el `master_admin` de `PLATFORM_ADMIN_EMAIL` (rol, `organizationId` y contraseña según env; ver logs `[bootstrap] created platform admin`, `upgraded user to master_admin`, `updated platform admin password`, `platform admin already valid`). Opcionalmente crea la demo si las cuatro variables `BOOTSTRAP_DEMO_*` están definidas. Idempotente.

### URLs a probar

Sustituye `TU_DOMINIO` por el hostname público del servicio:

- `https://TU_DOMINIO/api/health` → JSON `{ "ok": true, "db": "up" }` si Postgres responde.
- `https://TU_DOMINIO/` → `index.html` (mismo origen que `/api/*`, cookies de sesión válidas).

### Qué queda operativo tras el deploy

- API bajo `/api/*`, UI en `/`, Prisma + PostgreSQL, sesiones en tabla `session`, login estándar y rutas `/api/superadmin/*` para `master_admin`.
- CRUD de empresas y usuarios globales (`master_admin`), org/candidatos/asignaciones para empresa/candidato.

## Seguridad y secretos

- No subas `server/.env` ni archivos con URLs o contraseñas reales. Usa solo `server/.env.example` como plantilla.
- Tras el deploy, cambia cualquier contraseña de demostración que hayas puesto en variables de entorno si las compartiste.

## API (resumen)

- `GET /api/health`
- `POST /api/auth/login` — body `{ "email", "password" }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- **`master_admin` (misma sesión que el resto):** `GET/POST /api/superadmin/organizations`, `POST /api/superadmin/empresa-admins/quick` (alta rápida admin empresa + tokens 1–1000), `GET /api/superadmin/empresa-admins`, `GET /api/superadmin/registrations` (todos los usuarios), `POST /api/superadmin/users`, `PATCH /api/superadmin/organizations/:id`, `DELETE ...`, `GET /api/superadmin/evaluations`, `GET /api/superadmin/stats`, `POST /api/superadmin/assessment-definitions` (ver `src/routes/superadmin.routes.js`).
- **empresa_admin:** `GET/POST /api/org/candidates`, `GET /api/org/assessment-definitions`, `GET/POST /api/org/assignments`; además **`GET/POST /api/org/aspen-admins`** solo si el correo coincide con `ASPEN_PIONEER_ADMIN_EMAIL` (por defecto `admin@demo.mind24.com`): alta de otros admins Aspen con créditos por correo (`User.adminCredits`).
- **candidato:** `GET /api/me/assignments`, `POST /api/me/assignments/:id/start`, `POST /api/me/attempts/:id/submit`, `GET /api/me/attempts/:id/result`

Motor psicométrico: definiciones en JSON (`AssessmentDefinition.config`); el cálculo se hace solo en servidor al enviar el intento.
