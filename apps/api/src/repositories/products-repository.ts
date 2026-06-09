import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { ProductDto } from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import { notFound } from "../errors.js";
import { mapProduct } from "./row-mappers.js";

interface ProductRow extends RowDataPacket {
  id: number;
  title: string;
  image_url: string | null;
  description: string | null;
  created_by: number;
  created_at: Date;
}

const productColumns = "id, title, image_url, description, created_by, created_at";

export interface InsertProductInput {
  title: string;
  imageUrl: string | null;
  description: string | null;
  createdBy: number;
}

export async function insertProduct(
  db: DbExecutor,
  input: InsertProductInput
): Promise<ProductDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO products (title, image_url, description, created_by)
     VALUES (?, ?, ?, ?)`,
    [input.title, input.imageUrl, input.description, input.createdBy]
  );

  return findProductById(db, result.insertId);
}

export async function findProductById(db: DbExecutor, productId: number): Promise<ProductDto> {
  const [rows] = await db.execute<ProductRow[]>(
    `SELECT ${productColumns} FROM products WHERE id = ? LIMIT 1`,
    [productId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Product ${productId} was not found.`);
  }

  return mapProduct(row);
}
