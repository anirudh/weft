import type { FastifyInstance } from 'fastify';
import { bulkAudit, fillMissingHeaders, getHeaderProgress, runBulkFilter } from '../pipeline/bulk-run.js';
import { getExtractProgress, runExtraction } from '../pipeline/extract.js';

export async function pipelineRoutes(app: FastifyInstance) {
  /** One-off: fetch the headers the first ingest didn't keep. */
  app.post('/api/pipeline/headers', async () => {
    void fillMissingHeaders().then((r) => app.log.info({ ...r }, 'header backfill finished'));
    return { started: true };
  });
  app.get('/api/pipeline/headers/status', async () => getHeaderProgress());

  app.post('/api/pipeline/bulk', async () => {
    const result = await runBulkFilter();
    app.log.info({ ...result }, 'bulk filter finished');
    return result;
  });

  /** The checkpoint: what was dropped, why, and a sample of both sides. */
  app.get('/api/pipeline/bulk/audit', async () => bulkAudit());

  /** limit lets us sample a handful of threads before committing to the full run. */
  app.post<{ Body?: { limit?: number } }>('/api/pipeline/extract', async (req) => {
    const limit = req.body?.limit;
    void runExtraction(limit).then((r) => app.log.info({ ...r }, 'extraction finished'));
    return { started: true, limit: limit ?? 'all' };
  });
  app.get('/api/pipeline/extract/status', async () => getExtractProgress());
}
