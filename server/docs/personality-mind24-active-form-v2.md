# Personalidad Mind24 — forma activa v2

## Resumen

| Concepto | Valor |
|----------|--------|
| Banco total (catálogo + BD sync) | **80** reactivos |
| Forma activa v2 (intentos nuevos) | **60** reactivos, **6** por dimensión |
| Reserva (no en formularios nuevos) | **20** reactivos |
| Forma legacy v1 (intentos congelados) | **80** reactivos, **8** por dimensión |

## Versionado

- `PERSONALIDAD_MIND24_CATALOG_VERSION = 2` — etiqueta de módulo/sync en BD.
- `results.personalityMind24.formVersion`:
  - `1` — legacy (80)
  - `2` — activa (60)
- Si falta `formVersion`, se infiere por longitud de `presentationOrder` (80 → v1, 60 → v2).

## Reglas de migración

1. **No** se eliminan filas `Question` del banco de reserva; sync mantiene 80 preguntas activas.
2. Items fuera del banco sincronizable se **desactivan** (`isActive: false`), no se borran.
3. `presentationOrder` congelado en intentos existentes **no se regenera**.
4. Nuevos intentos: `buildPersonalityPresentationOrder` solo sobre los **60** IDs de `getPersonalityMind24ActiveFormItems()`.

## Fuente de verdad

- Shortlist activa: `PERSONALIDAD_MIND24_ACTIVE_FORM_ITEM_IDS` en `personalityMind24Data.js`.
- Reserva: `PERSONALIDAD_MIND24_RESERVE_FORM_ITEM_IDS`.
- Validación: `validatePersonalityMind24FormPartition()`.

## UX candidato

El conteo de preguntas en intro/progreso usa `questions.length` del intento (60 o 80 según forma congelada).

## Cierre

**PERSONALIDAD MIND24 — ACTIVE FORM v2 CLOSED** (2026-10-13)

Forma activa v2 en producción de código: nuevos intentos 60×6; banco 80; reserva 20; legacy v1 congelado por `presentationOrder`.
