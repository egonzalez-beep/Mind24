# Mind24 — Motor dinámico (React)

Esqueleto del motor de evaluaciones para integración futura con Vite/Next.

## Componentes

- `components/AssessmentRunner.jsx` — enrutador por `QuestionType`
- `components/questions/*` — UI por tipo

## API (candidato autenticado)

| Método | Ruta | Uso |
|--------|------|-----|
| POST | `/api/me/assignments/:id/start` | `{ moduleKey }` → `{ engine: 'dynamic', questions: [...] }` |
| GET | `/api/me/attempts/:id/engine` | Estado + preguntas |
| POST | `/api/me/attempts/:id/responses` | Guardar respuesta por pregunta |
| POST | `/api/me/attempts/:id/complete` | Cerrar módulo dinámico |

La SPA actual en `index.html` incluye un runner vanilla equivalente (`scr-dynamic`) para validación sin build de React.
