import { createClient, type RedisClientType } from "redis";
import { env } from "../config/env.js";

export type RespValue = string | number | null | RespValue[];

export interface RedisCommandClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  command(args: string[]): Promise<RespValue>;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, args?: string[]): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<RespValue>;
}

export class RedisNodeClient implements RedisCommandClient {
  private readonly client: RedisClientType;
  private connectPromise: Promise<void> | null = null;

  constructor() {
    this.client = createClient({
      url: `redis://${env.redis.host}:${env.redis.port}`,
      database: env.redis.db,
      ...(env.redis.password ? { password: env.redis.password } : {})
    });

    this.client.on("error", (error) => {
      console.error("Redis client error", error);
    });
  }

  async connect(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    this.connectPromise ??= this.client.connect().then(() => undefined);
    await this.connectPromise;
  }

  async close(): Promise<void> {
    if (!this.client.isOpen) {
      return;
    }

    await this.client.quit();
  }

  async command(args: string[]): Promise<RespValue> {
    await this.connect();
    return normalizeRespValue(await this.client.sendCommand(args));
  }

  async ping(): Promise<string> {
    const reply = await this.command(["PING"]);
    return String(reply);
  }

  async get(key: string): Promise<string | null> {
    const value = await this.command(["GET", key]);
    return typeof value === "string" ? value : null;
  }

  async set(key: string, value: string, args: string[] = []): Promise<string | null> {
    const reply = await this.command(["SET", key, value, ...args]);
    return typeof reply === "string" ? reply : null;
  }

  async del(key: string): Promise<number> {
    const reply = await this.command(["DEL", key]);
    return typeof reply === "number" ? reply : 0;
  }

  async eval(script: string, keys: string[], args: string[]): Promise<RespValue> {
    return this.command(["EVAL", script, String(keys.length), ...keys, ...args]);
  }
}

function normalizeRespValue(value: unknown): RespValue {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeRespValue);
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return String(value);
}

export function createRedisClient(): RedisCommandClient {
  return new RedisNodeClient();
}
