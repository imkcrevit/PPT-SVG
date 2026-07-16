import type { Locale } from "@/lib/types";

export type ProductRoute = "svg" | "ppt";

/** Public page routes; API and Next.js asset paths continue to use appUrl. */
export function productUrl(product: ProductRoute, locale: Locale): `/${ProductRoute}/${Locale}` {
  return `/${product}/${locale}`;
}
