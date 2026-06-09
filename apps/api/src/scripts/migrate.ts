import { readFile } from "node:fs/promises";
import mysql, { type ConnectionOptions } from "mysql2/promise";
import { env, paths } from "../config/env.js";

const sql = await readFile(paths.schemaSql, "utf8");

const connectionOptions: ConnectionOptions = {
  host: env.mysql.host,
  port: env.mysql.port,
  user: env.mysqlMigration.user,
  multipleStatements: true
};

if (env.mysqlMigration.password) {
  connectionOptions.password = env.mysqlMigration.password;
}

const connection = await mysql.createConnection(connectionOptions);

try {
  await connection.query(sql);
  console.log(`Applied schema from ${paths.schemaSql}`);
} finally {
  await connection.end();
}
