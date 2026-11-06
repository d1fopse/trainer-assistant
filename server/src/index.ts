import { loadConfig } from './config.js';
import { prisma } from './db.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config, prisma);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
