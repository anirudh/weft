import { config } from 'dotenv';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, two levels up from apps/server/src. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

config({ path: resolve(REPO_ROOT, '.env') });

const Env = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  GOOGLE_SCOPES: z.string().min(1),

  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().min(1),

  GEMINI_EXTRACT_MODEL: z.string().min(1),
  GEMINI_EXTRACT_THINKING: z.enum(['minimal', 'low', 'medium', 'high']),
  GEMINI_COMPOSE_MODEL: z.string().min(1),
  GEMINI_COMPOSE_THINKING: z.enum(['minimal', 'low', 'medium', 'high']),

  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().default('./data/weft.db'),
  BACKFILL_DAYS: z.coerce.number().default(30),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('\nInvalid .env — Weft cannot start:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nSee .env.example for the expected keys.\n');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** DATABASE_URL resolved against the repo root, not the server's cwd. */
  DATABASE_PATH: resolve(REPO_ROOT, parsed.data.DATABASE_URL),
};
