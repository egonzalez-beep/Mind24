import { createApp } from './app.js';
import { env } from './config/env.js';
import { runBootstrapUsers } from './services/bootstrap.service.js';

const app = createApp();

try {
  await runBootstrapUsers();
} catch (e) {
  console.error('[bootstrap] error:', e?.message || e);
}

app.listen(env.PORT, () => {
  console.log(`Mind24 API listening on :${env.PORT}`);
});
