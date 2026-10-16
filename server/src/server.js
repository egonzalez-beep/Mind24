import { createApp } from './app.js';
import { env } from './config/env.js';
import { runBootstrapUsers } from './services/bootstrap.service.js';
import { ensureEvaluationCatalog } from './services/evaluationCatalog.service.js';
import { resolveTimeclockPublicLinkBase } from './services/timeclockToken.service.js';

const app = createApp();

try {
  await ensureEvaluationCatalog();
} catch (e) {
  console.error('[catalog] error:', e?.message || e);
  if (env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

try {
  await runBootstrapUsers();
} catch (e) {
  console.error('[bootstrap] error:', e?.message || e);
}

app.listen(env.PORT, () => {
  console.log(`Mind24 API listening on :${env.PORT}`);
  try {
    console.log(`[timeclock] public link base: ${resolveTimeclockPublicLinkBase()}`);
  } catch (e) {
    console.warn(`[timeclock] public link base unresolved: ${e?.message || e}`);
  }
});
