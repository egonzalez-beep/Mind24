/**
 * Validación estructural del banco Cleaver (modelo M/L).
 *
 * Comprueba que cada opción declare una clave MÁS/MENOS que el scorer pueda
 * procesar de forma determinista. Deliberadamente NO exige que cada tétrada
 * contenga exactamente una D, una I, una S y una C: esa regla pertenece al
 * modelo de dimensión única y no describe la clave real del instrumento.
 */
import {
  CLEAVER_DISC_KEYS,
  CLEAVER_KEY_SCHEMA,
  CLEAVER_KEY_STATUS,
  CLEAVER_KEY_STATUSES,
} from './cleaverDiscKey.js';

export const CLEAVER_EXPECTED_TETRADS = 24;
export const CLEAVER_OPTIONS_PER_TETRAD = 4;

const ROLE_FIELDS = ['dimensionMore', 'dimensionLess'];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidDimensionValue(value) {
  return value === null || (typeof value === 'string' && CLEAVER_DISC_KEYS.includes(value));
}

/**
 * Valida la metadata M/L de una sola opción.
 * @returns {string[]} lista de errores (vacía si es válida)
 */
export function validateCleaverOptionMetadata(metadata, label = 'opción') {
  const errors = [];

  if (!isPlainObject(metadata)) {
    errors.push(`${label}: metadata debe ser un objeto`);
    return errors;
  }

  if (metadata.keySchema !== CLEAVER_KEY_SCHEMA) {
    errors.push(`${label}: keySchema debe ser "${CLEAVER_KEY_SCHEMA}" (recibido ${JSON.stringify(metadata.keySchema)})`);
  }

  if (!CLEAVER_KEY_STATUSES.includes(metadata.keyStatus)) {
    errors.push(`${label}: keyStatus inválido (${JSON.stringify(metadata.keyStatus)})`);
  }

  for (const field of ROLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, field)) {
      errors.push(`${label}: falta ${field}`);
      continue;
    }
    if (!isValidDimensionValue(metadata[field])) {
      errors.push(
        `${label}: ${field} debe ser D, I, S, C o null (recibido ${JSON.stringify(metadata[field])})`,
      );
    }
  }

  const more = metadata.dimensionMore;
  const less = metadata.dimensionLess;

  if (more === null && less === null) {
    errors.push(`${label}: dimensionMore y dimensionLess no pueden ser null a la vez`);
  }

  // `dimension` es un espejo de compatibilidad: solo válido cuando M y L coinciden.
  if (Object.prototype.hasOwnProperty.call(metadata, 'dimension')) {
    const symmetric = more !== null && more === less;
    if (!symmetric) {
      errors.push(`${label}: dimension solo puede existir cuando dimensionMore === dimensionLess`);
    } else if (metadata.dimension !== more) {
      errors.push(`${label}: dimension (${metadata.dimension}) no coincide con la clave M/L (${more})`);
    }
  }

  return errors;
}

function duplicateDimensions(dimensions) {
  const seen = new Set();
  const dups = new Set();
  for (const dim of dimensions) {
    if (dim === null) continue;
    if (seen.has(dim)) dups.add(dim);
    seen.add(dim);
  }
  return [...dups].sort();
}

/**
 * Valida el banco completo.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], summary: object }}
 */
export function validateCleaverBank(blocks) {
  const errors = [];
  const warnings = [];
  const verifiedBlocks = [];
  const pendingBlocks = [];
  let optionCount = 0;

  if (!Array.isArray(blocks)) {
    return {
      ok: false,
      errors: ['banco Cleaver: se esperaba un array de tétradas'],
      warnings,
      summary: null,
    };
  }

  if (blocks.length !== CLEAVER_EXPECTED_TETRADS) {
    errors.push(`banco Cleaver: se esperaban ${CLEAVER_EXPECTED_TETRADS} tétradas, hay ${blocks.length}`);
  }

  const seenOrders = new Set();

  for (const block of blocks) {
    const order = block?.order;
    const blockLabel = `tétrada ${order ?? '?'}`;

    if (!Number.isInteger(order) || order < 1 || order > CLEAVER_EXPECTED_TETRADS) {
      errors.push(`${blockLabel}: order debe ser un entero entre 1 y ${CLEAVER_EXPECTED_TETRADS}`);
    } else if (seenOrders.has(order)) {
      errors.push(`${blockLabel}: order duplicado`);
    } else {
      seenOrders.add(order);
    }

    const options = Array.isArray(block?.options) ? block.options : [];
    if (options.length !== CLEAVER_OPTIONS_PER_TETRAD) {
      errors.push(`${blockLabel}: debe tener exactamente ${CLEAVER_OPTIONS_PER_TETRAD} opciones, tiene ${options.length}`);
    }

    const texts = new Set();
    const statuses = new Set();

    for (const option of options) {
      optionCount++;
      const text = typeof option?.text === 'string' ? option.text.trim() : '';
      if (!text) {
        errors.push(`${blockLabel}: hay una opción sin texto`);
      } else if (texts.has(text)) {
        errors.push(`${blockLabel}: texto duplicado "${text}"`);
      } else {
        texts.add(text);
      }

      const optionErrors = validateCleaverOptionMetadata(
        option?.metadata,
        `${blockLabel} · ${text || 'opción sin texto'}`,
      );
      errors.push(...optionErrors);

      if (isPlainObject(option?.metadata)) statuses.add(option.metadata.keyStatus);
    }

    if (statuses.size > 1) {
      errors.push(`${blockLabel}: keyStatus mixto en la misma tétrada (${[...statuses].join(', ')})`);
    }

    if (Number.isInteger(order)) {
      const status = [...statuses][0];
      if (status === CLEAVER_KEY_STATUS.VERIFIED) verifiedBlocks.push(order);
      else if (status === CLEAVER_KEY_STATUS.PENDING) pendingBlocks.push(order);
    }

    if (options.length === CLEAVER_OPTIONS_PER_TETRAD) {
      const moreDims = options.map((o) => (isPlainObject(o?.metadata) ? o.metadata.dimensionMore : undefined));
      const lessDims = options.map((o) => (isPlainObject(o?.metadata) ? o.metadata.dimensionLess : undefined));
      const dupMore = duplicateDimensions(moreDims);
      const dupLess = duplicateDimensions(lessDims);
      if (dupMore.length) {
        warnings.push(`${blockLabel}: clave MÁS repite ${dupMore.join(', ')} (válido en el modelo M/L, revisar contra plantilla)`);
      }
      if (dupLess.length) {
        warnings.push(`${blockLabel}: clave MENOS repite ${dupLess.join(', ')} (válido en el modelo M/L, revisar contra plantilla)`);
      }
    }
  }

  verifiedBlocks.sort((a, b) => a - b);
  pendingBlocks.sort((a, b) => a - b);

  if (pendingBlocks.length) {
    warnings.push(
      `clave M/L pendiente de verificación en ${pendingBlocks.length} tétrada(s): ${pendingBlocks.join(', ')}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      blocks: blocks.length,
      options: optionCount,
      verifiedBlocks,
      pendingBlocks,
      verifiedCount: verifiedBlocks.length,
      pendingCount: pendingBlocks.length,
      /** true solo cuando las 24 tétradas tienen clave M/L verificada. */
      fullyVerified: errors.length === 0 && pendingBlocks.length === 0,
    },
  };
}

/** Lanza si el banco no es procesable por el scorer. */
export function assertValidCleaverBank(blocks) {
  const result = validateCleaverBank(blocks);
  if (!result.ok) {
    throw new Error(`Banco Cleaver inválido:\n- ${result.errors.join('\n- ')}`);
  }
  return result;
}
