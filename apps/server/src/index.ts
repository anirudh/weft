import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, REPO_ROOT } from './env.js';
import { runMigrations } from './db/index.js';
import { horizonRoutes } from './routes/horizon.js';
import { accountRoutes } from './routes/accounts.js';
import { syncRoutes } from './routes/sync.js';
import { pipelineRoutes } from './routes/pipeline.js';
import { obligationRoutes } from './routes/obligations.js';

const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } });

const applied = runMigrations();
if (applied.length) app.log.info({ applied }, 'migrations applied');

app.get('/api/health', async () => ({ ok: true, project: env.GOOGLE_CLOUD_PROJECT }));
await app.register(accountRoutes);
await app.register(syncRoutes);
await app.register(pipelineRoutes);
await app.register(horizonRoutes);
await app.register(obligationRoutes);

// In dev, Vite serves the UI and proxies /api here. In production the built
// assets are served by this same process, so Weft is one command and one port.
const webDist = resolve(REPO_ROOT, 'apps/web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: env.PORT, host: '127.0.0.1' });
