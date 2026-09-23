import { Router } from 'express';
import { requireAuth, requireCustomer } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { getProduct, listProducts } from '../store.js';
import type { ProductRow } from '../store.js';

export const productsRouter = Router();

productsRouter.use(requireAuth, requireCustomer);

/**
 * Catalogue rows are stored snake_case but served camelCase, matching the cart
 * and checkout payloads. Serving raw rows here silently produced `undefined`
 * prices in the client, so the mapping is explicit and covered by tests.
 */
interface ProductDto {
  id: string;
  sku: string;
  name: string;
  description: string;
  details: string;
  pricePaise: number;
  imageUrl: string | null;
  stock: number;
  active: boolean;
}

function toProductDto(row: ProductRow): ProductDto {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    details: row.details,
    pricePaise: row.price_paise,
    imageUrl: row.image_url === '' ? null : row.image_url,
    stock: row.stock,
    active: row.active === 1,
  };
}

productsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ products: listProducts().map(toProductDto) });
  }),
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = getProduct(req.params.id);
    if (product === undefined) {
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    res.json({ product: toProductDto(product) });
  }),
);
