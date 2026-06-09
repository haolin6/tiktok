import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { env } from "../config/env.js";

export type DbPool = Pool;

export function createDbPool(overrides: Partial<PoolOptions> = {}): DbPool {
  return mysql.createPool({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    database: env.mysql.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    decimalNumbers: true,
    ...overrides
  });
}
