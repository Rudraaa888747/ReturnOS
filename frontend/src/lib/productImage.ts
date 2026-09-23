/**
 * Single source of truth for product images.
 *
 * Rule: backend `imageUrl` / `product_image_url` snapshot wins, so Store and
 * My Orders always show the SAME real photo. Only when the backend has no
 * image do we infer one from the product NAME (not a random hash), so e.g.
 * a tee never shows a shoe picture.
 */

function unsplash(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?w=800&q=80&auto=format&fit=crop`;
}

export const REAL_PRODUCT_IMAGES = {
  airmax: unsplash('photo-1542291026-7eec264c27ff'),
  trail: unsplash('photo-1520639888713-7851133b1ed0'),
  denim: unsplash('photo-1542272604-787c3835535d'),
  aurora: unsplash('photo-1737056207688-acc991990309'),
  tee: unsplash('photo-1521572163474-6864f9cf17ab'),
} as const;

const BY_NAME: Array<{ match: RegExp; image: string }> = [
  { match: /air\s?max|runner|sneaker/i, image: REAL_PRODUCT_IMAGES.airmax },
  { match: /trail|hiking|boot|trek/i, image: REAL_PRODUCT_IMAGES.trail },
  { match: /denim|jean/i, image: REAL_PRODUCT_IMAGES.denim },
  { match: /aurora|scarf|wool|shawl/i, image: REAL_PRODUCT_IMAGES.aurora },
  { match: /tee|t-shirt|tshirt|cotton/i, image: REAL_PRODUCT_IMAGES.tee },
  { match: /jacket|hoodie|coat/i, image: REAL_PRODUCT_IMAGES.aurora },
  { match: /headphone|earbud|audio/i, image: REAL_PRODUCT_IMAGES.airmax },
];

export const GENERIC_PRODUCT_IMAGE = REAL_PRODUCT_IMAGES.tee;

export interface ProductImageInput {
  imageUrl?: string | null;
  product_image_url?: string | null;
  productImageUrl?: string | null;
  name?: string | null;
  product_name?: string | null;
  productName?: string | null;
  productId?: string | null;
  product_id?: string | null;
  sku?: string | null;
}

function firstNonEmpty(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return null;
}

/** Image for a store product row. Prefers backend image, else maps by name. */
export function productImageFor(input: ProductImageInput): string {
  const direct = firstNonEmpty(input.imageUrl, input.productImageUrl, input.product_image_url);
  if (direct) return direct;

  const haystack = firstNonEmpty(
    input.name,
    input.product_name,
    input.productName,
    input.sku,
    input.productId,
    input.product_id,
  );
  if (!haystack) return GENERIC_PRODUCT_IMAGE;

  for (const entry of BY_NAME) {
    if (entry.match.test(haystack)) return entry.image;
  }
  return GENERIC_PRODUCT_IMAGE;
}

/** Image for an order/return/cart line — same helper, so pics always match Store. */
export function orderItemImageFor(
  item: ProductImageInput & { productId?: string | null; product_id?: string | null },
  fallbackName?: string | null,
): string {
  if (item.imageUrl ?? item.productImageUrl ?? item.product_image_url) {
    return productImageFor(item);
  }
  return productImageFor({ ...item, name: firstNonEmpty(item.name, item.product_name, item.productName, fallbackName) });
}
