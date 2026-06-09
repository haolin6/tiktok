import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(configDir, "../../../../");
const envPath = resolve(repoRoot, ".env");
const exampleEnvPath = resolve(repoRoot, ".env.example");

if (existsSync(envPath)) {
  config({ path: envPath });
}

if (existsSync(exampleEnvPath)) {
  config({ path: exampleEnvPath });
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable ${name}: ${raw}`);
  }

  return parsed;
}

function readString(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const env = {
  nodeEnv: readString("NODE_ENV", "development"),
  apiPort: readNumber("API_PORT", 4000),
  mysql: {
    host: readString("MYSQL_HOST", "127.0.0.1"),
    port: readNumber("MYSQL_PORT", 3306),
    database: readString("MYSQL_DATABASE", "live_auction"),
    user: readString("MYSQL_USER", "auction_app"),
    password: readString("MYSQL_PASSWORD", "change_me")
  },
  mysqlMigration: {
    user: readString("MYSQL_MIGRATION_USER", "root"),
    password: readOptionalString("MYSQL_MIGRATION_PASSWORD")
  },
  redis: {
    host: readString("REDIS_HOST", "127.0.0.1"),
    port: readNumber("REDIS_PORT", 6379),
    password: readOptionalString("REDIS_PASSWORD"),
    db: readNumber("REDIS_DB", 0)
  }
};

export const paths = {
  repoRoot,
  schemaSql: resolve(repoRoot, "infra/mysql/init/001_create_schema.sql")
};
