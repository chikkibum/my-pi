import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the harness's own folder, not the cwd, so `mypi` finds its
// keys when run inside any other project. Imported first by main.ts so the
// values are set before provider modules read them.
export const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(HARNESS_ROOT, '.env'), quiet: true });
