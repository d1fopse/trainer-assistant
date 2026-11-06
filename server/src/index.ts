import { loadConfig } from './config.js';
import { connectDb } from './db/index.js';
import { buildApp } from './app.js';

const config = loadConfig();
// Підключення до бази й застосування міграцій (створення/оновлення таблиць).
const { db } = await connectDb(config.databaseUrl);
const app = await buildApp(config, db);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
