import type { FieldPacket, QueryResult } from "mysql2";

export interface DbExecutor {
  execute<T extends QueryResult>(sql: string, values?: unknown): Promise<[T, FieldPacket[]]>;
}
