export const PRODUCT_IDENTITY_SELECT = "id, name, brand, ean, category, package_size, image_url, desired_stock, target_price, target_price_unit, preferred_store, is_basis, is_freezable, notes";

export type ProductIdentityRow = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  desired_stock: number | null;
  target_price?: number | null;
  target_price_unit?: string | null;
  preferred_store?: string | null;
  is_basis: boolean | null;
  is_freezable?: boolean | null;
  notes?: string | null;
};

export function normalizeProductEan(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").trim() || null;
}

export async function findCanonicalProductByEan<T = ProductIdentityRow>(
  supabase: any,
  ean: unknown,
  select = PRODUCT_IDENTITY_SELECT
): Promise<T | null> {
  const normalizedEan = normalizeProductEan(ean);
  if (!normalizedEan) return null;

  const result = await supabase
    .from("products")
    .select(select)
    .eq("ean", normalizedEan)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (result.error) throw result.error;
  return (result.data as T | null) ?? null;
}

export async function insertProductWithoutDuplicate<T = ProductIdentityRow>(
  supabase: any,
  payload: Record<string, unknown>,
  select = PRODUCT_IDENTITY_SELECT
): Promise<{ data: T; reusedExisting: boolean }> {
  const normalizedEan = normalizeProductEan(payload.ean);
  const insertPayload = { ...payload, ean: normalizedEan };

  const existing = normalizedEan ? await findCanonicalProductByEan<T>(supabase, normalizedEan, select) : null;
  if (existing) return { data: existing, reusedExisting: true };

  const inserted = await supabase.from("products").insert(insertPayload).select(select).single();

  if (inserted.error) {
    const code = typeof inserted.error === "object" && inserted.error !== null && "code" in inserted.error
      ? String((inserted.error as { code?: unknown }).code)
      : "";

    if (normalizedEan && code === "23505") {
      const existingAfterConflict = await findCanonicalProductByEan<T>(supabase, normalizedEan, select);
      if (existingAfterConflict) return { data: existingAfterConflict, reusedExisting: true };
    }

    throw inserted.error;
  }

  return { data: inserted.data as T, reusedExisting: false };
}
