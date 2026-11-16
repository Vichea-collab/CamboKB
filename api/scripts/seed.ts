import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCatalog } from '../src/cli/seed';
import { loadConfig } from '../src/config';
import { HttpFileClient } from '../src/files/client';
import { createPrisma } from '../src/prisma';

// Usage: npm run db:seed  (needs the file service running: npm run dev -w file)
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.argv[2] ?? path.resolve(here, '../seed-data');

const config = loadConfig();
const prisma = createPrisma(config.databaseUrl);
const files = new HttpFileClient(config.services.fileUrl, config.services.fileSecret, config.services.publicFilesUrl);

seedCatalog({ prisma, files }, dataDir, console.log)
  .then((r) => {
    if (!r.skipped) console.log(`Seeded ${r.products} products, ${r.images} photos, ${r.banners} banners.`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
