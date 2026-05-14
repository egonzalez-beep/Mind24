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
| master_admin | master@mind24.local | ChangeMeMaster123! |
| empresa_admin | admin@demo.mind24.local | ChangeMeAdmin123! |
| candidato | candidato@demo.mind24.local | ChangeMeCandidato123! |

Cambia estas contraseñas en producción.

## API (resumen)

- `GET /api/health`
- `POST /api/auth/login` — body `{ "email", "password" }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- **master_admin:** `GET/POST /api/master/organizations`, `PATCH /api/master/organizations/:id`, `GET /api/master/stats`, `POST /api/master/assessment-definitions`
- **empresa_admin:** `GET/POST /api/org/candidates`, `GET /api/org/assessment-definitions`, `GET/POST /api/org/assignments`
- **candidato:** `GET /api/me/assignments`, `POST /api/me/assignments/:id/start`, `POST /api/me/attempts/:id/submit`, `GET /api/me/attempts/:id/result`

Motor psicométrico: definiciones en JSON (`AssessmentDefinition.config`); el cálculo se hace solo en servidor al enviar el intento.
