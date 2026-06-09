import type { CreateProductRequest, ProductDto } from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import { validationError } from "../errors.js";
import { insertAuctionEvent } from "../repositories/events-repository.js";
import { insertProduct } from "../repositories/products-repository.js";
import { findDefaultStreamerId, userExists } from "../repositories/users-repository.js";

export async function createProduct(
  pool: DbPool,
  input: CreateProductRequest
): Promise<ProductDto> {
  const title = input.title.trim();
  if (!title) {
    throw validationError("Product title is required.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const createdBy = input.createdBy ?? (await findDefaultStreamerId(connection));
    if (input.createdBy && !(await userExists(connection, input.createdBy))) {
      throw validationError(`User ${input.createdBy} does not exist.`);
    }

    const product = await insertProduct(connection, {
      title,
      imageUrl: input.imageUrl?.trim() || null,
      description: input.description?.trim() || null,
      createdBy
    });

    await insertAuctionEvent(connection, {
      auctionId: null,
      eventType: "product.created",
      payload: {
        productId: product.id,
        title: product.title,
        createdBy
      }
    });

    await connection.commit();
    return product;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
