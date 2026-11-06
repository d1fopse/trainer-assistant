import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

/** Папка з SQL-міграціями: server/drizzle (працює і з src/, і з dist/). */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function connectDb(databaseUrl: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => pool.end() };
}

export { schema };
