import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Apply pending SQL migrations from src/migrations. Idempotent: applied
 * entries are journaled in drizzle.__drizzle_migrations, so running this
 * twice (or from several replicas racing at startup — drizzle takes an
 * advisory lock) is safe.
 *
 * The baseline migration uses IF NOT EXISTS so a local database created with
 * `bun db:push` can be adopted into the journal without dropping its data.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  if (!databaseUrl) throw new Error("runMigrations: DATABASE_URL is not set");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}
