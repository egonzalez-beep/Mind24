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
- **Superadmin (panel en la web):** `SUPERADMIN_EMAIL` (único correo permitido) y `SUPERADMIN_PASSWORD_HASH` (bcrypt de la contraseña). Si no defines el hash, el servidor usa un hash embebido solo para desarrollo (contraseña por defecto documentada en `src/config/env.js`). El superadmin **no** es un usuario en base de datos; la sesión es cookie httpOnly en `/api/superadmin/*`.

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

## Railway

1. Servicio Node: directorio raíz del repo o `server`; comando de inicio, por ejemplo:  
   `cd server && npm install && npx prisma migrate deploy && npm run db:seed && npm start`  
   (ajusta si no quieres ejecutar seed en cada despliegue).
2. Variables: `DATABASE_URL` y `SESSION_SECRET` (y `NODE_ENV=production`).
3. Volumen persistente: útil para logs o futuros uploads; la base de datos sigue en PostgreSQL.

## Cuentas de demostración (tras `npm run db:seed`)

| Rol | Email | Contraseña |
|-----|--------|--------------|
| empresa_admin | admin@demo.mind24.local | ChangeMeAdmin123! |
| candidato | candidato@demo.mind24.local | ChangeMeCandidato123! |

El panel de **administrador general** no viene del seed: usa `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD_HASH` (o el hash por defecto de desarrollo en código). Crea empresas desde el UI o vía `POST /api/superadmin/organizations` con sesión de superadmin.

Cambia estas contraseñas en producción.

## API (resumen)

- `GET /api/health`
- `POST /api/auth/login` — body `{ "email", "password" }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- **Superadmin (sesión aparte, `req.session.superAdmin`):** `POST /api/superadmin/login`, `POST /api/superadmin/logout`, `GET /api/superadmin/me`, y con sesión válida: organizaciones, créditos, evaluaciones globales, etc. (ver `src/routes/superadmin.routes.js`).
- **empresa_admin:** `GET/POST /api/org/candidates`, `GET /api/org/assessment-definitions`, `GET/POST /api/org/assignments`
- **candidato:** `GET /api/me/assignments`, `POST /api/me/assignments/:id/start`, `POST /api/me/attempts/:id/submit`, `GET /api/me/attempts/:id/result`

Motor psicométrico: definiciones en JSON (`AssessmentDefinition.config`); el cálculo se hace solo en servidor al enviar el intento.
