"use client";

import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr, unitPriceLabel } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  category: string | null;
  package_size: string | null;
  image_url: string | null;
  target_price: number | null;
  target_price_unit: string | null;
  desired_stock: number | null;
  is_basis: boolean | null;
  is_freezable: boolean | null;
  preferred_store: string | null;
  notes: string | null;
  description?: string | null;
  ingredients?: string | null;
  allergens?: unknown | null;
  nutrition?: unknown | null;
  labels?: unknown | null;
  category_path?: string[] | null;
};

type InventoryItem = {
  id: string;
  location: string;
  quantity: number;
  desired_quantity: number;
  expires_at: string | null;
  updated_at: string | null;
};

type Observation = {
  id: string;
  store_code: string;
  store_name: string;
  price: number;
  unit_price: number | null;
  comparison_unit: string | null;
  package_quantity?: number | null;
  package_unit?: string | null;
  unit_price_was_corrected?: boolean | null;
  stored_unit_price?: number | null;
  recomputed_unit_price?: number | null;
  observed_at: string;
  source: string | null;
  source_url: string | null;
};

type ProductGroupPriceOption = {
  product_id: string;
  product_name: string;
  ean: string | null;
  package_size: string | null;
  store_name: string;
  store_code: string | null;
  price: number | null;
  unit_price: number | null;
  comparison_unit: string | null;
  observed_at: string | null;
  source: string | null;
  source_url: string | null;
  age_days?: number | null;
  freshness?: "fresh" | "check";
  is_scanned_product: boolean;
};

type ProductGroupSummary = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  comparison_unit: string | null;
  package_count: number;
  cheapest: ProductGroupPriceOption | null;
  scanned_product_best_price: ProductGroupPriceOption | null;
  price_options: ProductGroupPriceOption[];
};

type DetailPayload = {
  product: Product;
  inventory: InventoryItem[];
  price_observations: Observation[];
  latest_by_store: Array<{ store_name: string; price: number; unit_price: number | null; comparison_unit: string | null; observed_at: string; source: string | null; source_url: string | null }>;
  product_group?: ProductGroupSummary | null;
};

function shortDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-";
}

function shortDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat("nb-NO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function currentPriceLabel(option?: ProductGroupPriceOption | null) {
  if (!option) return null;
  if (option.freshness === "fresh") return "Aktuell pris";
  return "Bør sjekkes";
}

function currentPriceClass(option?: ProductGroupPriceOption | null) {
  if (!option) return "bg-slate-50 text-slate-600";
  if (option.freshness === "fresh") return "bg-emerald-50 text-brand";
  return "bg-amber-50 text-amber-800";
}

function ageText(ageDays?: number | null) {
  if (ageDays == null) return "ukjent alder";
  if (ageDays === 0) return "i dag";
  if (ageDays === 1) return "i går";
  return `${ageDays} dager`;
}

function priceSourceLabel(source?: string | null) {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (!normalized) return "Ukjent kilde";
  if (normalized.includes("receipt")) return "Kvittering";
  if (normalized.includes("shelf")) return "Hyllekant";
  if (normalized.includes("manual")) return "Manuelt";
  if (normalized.includes("kassalapp")) return "Kassalapp API";
  if (normalized.includes("mobile-scan")) return "Kassalapp API";

  return source ?? "Ukjent kilde";
}



function formatNumberNb(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("nb-NO", {
    maximumFractionDigits,
    minimumFractionDigits: 0
  }).format(value);
}

function toNumeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProductUnit(value: string | null | undefined) {
  const unit = String(value ?? "").trim().toLowerCase();
  if (["kg", "kilo", "kilogram"].includes(unit)) return "kg";
  if (["g", "gram"].includes(unit)) return "g";
  if (["l", "liter", "litre", "ltr"].includes(unit)) return "l";
  if (["ml", "milliliter"].includes(unit)) return "ml";
  if (["stk", "pk", "pakke", "pakker"].includes(unit)) return "stk";
  return unit || null;
}

function toComparisonQuantity(amount: number, unit: string | null | undefined) {
  const normalized = normalizeProductUnit(unit);
  if (normalized === "kg") return { quantity: amount, unit: "kg" };
  if (normalized === "g") return { quantity: amount / 1000, unit: "kg" };
  if (normalized === "l") return { quantity: amount, unit: "l" };
  if (normalized === "ml") return { quantity: amount / 1000, unit: "l" };
  if (normalized === "stk") return { quantity: amount, unit: "stk" };
  return null;
}

function formatQuantity(value: number | null | undefined, unit: string | null | undefined) {
  const amount = toNumeric(value);
  const normalized = normalizeProductUnit(unit);
  if (amount === null || !normalized) return null;
  return `${formatNumberNb(amount)} ${normalized}`;
}

function parseMultipackFromName(name: string | null | undefined) {
  const text = String(name ?? "").toLowerCase().replace(/,/g, ".");
  const patterns: Array<{ regex: RegExp; countIndex: number; amountIndex: number; unitIndex: number }> = [
    { regex: /(\d+(?:\.\d+)?)\s*(kg|g|l|liter|ml)\s*x\s*(\d+)/, countIndex: 3, amountIndex: 1, unitIndex: 2 },
    { regex: /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|liter|ml)/, countIndex: 1, amountIndex: 2, unitIndex: 3 }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex) ?? text.replace(/\s+/g, "").match(pattern.regex);
    if (!match) continue;
    const count = toNumeric(match[pattern.countIndex]);
    const amount = toNumeric(match[pattern.amountIndex]);
    const unit = normalizeProductUnit(match[pattern.unitIndex]);
    if (!count || count <= 1 || !amount || amount <= 0 || !unit) continue;
    const convertedSingle = toComparisonQuantity(amount, unit);
    const convertedTotal = toComparisonQuantity(amount * count, unit);
    if (!convertedSingle || !convertedTotal) continue;
    return {
      count,
      singleAmount: amount,
      singleUnit: unit,
      comparisonQuantity: convertedTotal.quantity,
      comparisonUnit: convertedTotal.unit
    };
  }

  return null;
}

function hasExplicitUnit(value: string | null | undefined) {
  return /[a-zA-ZæøåÆØÅ]/.test(String(value ?? ""));
}

function packageDisplay(product: Product, observation?: Pick<Observation, "package_quantity" | "package_unit" | "comparison_unit"> | null) {
  const packageQuantity = toNumeric(observation?.package_quantity);
  const packageUnit = normalizeProductUnit(observation?.package_unit ?? observation?.comparison_unit ?? null);
  const multipack = parseMultipackFromName(product.name);

  if (
    multipack &&
    packageQuantity !== null &&
    packageUnit === multipack.comparisonUnit &&
    Math.abs(packageQuantity - multipack.comparisonQuantity) / Math.max(multipack.comparisonQuantity, 0.01) < 0.05 &&
    !hasExplicitUnit(product.package_size)
  ) {
    return `${formatNumberNb(multipack.singleAmount)} ${multipack.singleUnit} x ${formatNumberNb(multipack.count, 0)} = ${formatNumberNb(packageQuantity)} ${packageUnit}`;
  }

  if (packageQuantity !== null && packageUnit) {
    return formatQuantity(packageQuantity, packageUnit) ?? `${formatNumberNb(packageQuantity)} ${packageUnit}`;
  }

  const rawPackageSize = toNumeric(product.package_size);
  if (multipack && rawPackageSize !== null && !hasExplicitUnit(product.package_size)) {
    return `${formatNumberNb(multipack.singleAmount)} ${multipack.singleUnit} x ${formatNumberNb(multipack.count, 0)} = ${formatNumberNb(multipack.comparisonQuantity)} ${multipack.comparisonUnit}`;
  }

  if (product.package_size) return product.package_size;
  return "Ukjent pakning";
}

function packageOptionDisplay(option: ProductGroupPriceOption) {
  const multipack = parseMultipackFromName(option.product_name);
  const rawPackageSize = toNumeric(option.package_size);

  if (multipack) {
    return `${formatNumberNb(multipack.singleAmount)} ${multipack.singleUnit} x ${formatNumberNb(multipack.count, 0)} = ${formatNumberNb(multipack.comparisonQuantity)} ${multipack.comparisonUnit}`;
  }

  if (rawPackageSize !== null && !hasExplicitUnit(option.package_size)) {
    if (option.comparison_unit === "l") return `${formatNumberNb(rawPackageSize / 1000)} l`;
    if (option.comparison_unit === "kg") return `${formatNumberNb(rawPackageSize / 1000)} kg`;
    return `${formatNumberNb(rawPackageSize)} ${unitSuffix(option.comparison_unit)}`;
  }

  return option.package_size ?? option.product_name;
}

function unitSuffix(unit: string | null | undefined) {
  if (unit === "kg") return "kg";
  if (unit === "l") return "l";
  if (unit === "stk") return "stk";
  return "enhet";
}

function unitSavings(current: ProductGroupPriceOption | null | undefined, cheapest: ProductGroupPriceOption | null | undefined) {
  if (!current || !cheapest) return null;
  if (current.product_id === cheapest.product_id) return null;
  if (current.unit_price == null || cheapest.unit_price == null) return null;
  if (current.comparison_unit !== cheapest.comparison_unit) return null;
  const diff = current.unit_price - cheapest.unit_price;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return `${kr(diff)} billigere per ${unitSuffix(cheapest.comparison_unit)}`;
}

function toFormValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function shortJson(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item?.name ?? item?.label ?? item?.value ?? JSON.stringify(item)))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
      .join(" · ");
  }
  return String(value);
}

export default function ProductRulesPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const [data, setData] = useState<DetailPayload | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const response = await authFetch(`/api/products/${productId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke hente produkt");
      return;
    }
    const detail = payload.data as DetailPayload;
    setData(detail);
    setForm({
      name: toFormValue(detail.product.name),
      brand: toFormValue(detail.product.brand),
      category: toFormValue(detail.product.category),
      package_size: toFormValue(detail.product.package_size),
      target_price: toFormValue(detail.product.target_price),
      target_price_unit: detail.product.target_price_unit ?? "unit",
      desired_stock: toFormValue(detail.product.desired_stock),
      is_basis: Boolean(detail.product.is_basis),
      is_freezable: Boolean(detail.product.is_freezable),
      preferred_store: toFormValue(detail.product.preferred_store),
      notes: toFormValue(detail.product.notes)
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const response = await authFetch(`/api/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke lagre regler");
      return;
    }
    setMessage("Produktregler lagret.");
    await load();
  }

  async function syncProduct() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    const response = await authFetch(`/api/products/${productId}/sync`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setSyncing(false);
    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke synke produkt");
      return;
    }
    setMessage(`Synket ${payload.inserted ?? 0} prisobservasjoner for produktet.`);
    await load();
  }

  async function editPriceObservation(observation: Observation) {
    const priceText = window.prompt("Ny siste pris", String(observation.price).replace(".", ","));
    if (priceText === null) return;

    const price = Number(priceText.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      setError("Pris må være større enn 0.");
      return;
    }

    const storeName = window.prompt("Butikk", observation.store_name);
    if (storeName === null) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const response = await authFetch(`/api/products/${productId}/prices/${observation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price,
        unit_price: observation.unit_price,
        store_name: storeName
      })
    });

    const payload = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke endre siste pris");
      return;
    }

    setMessage("Siste pris er oppdatert manuelt.");
    await load();
  }

  async function deletePriceObservation(observation: Observation) {
    const ok = window.confirm(`Slette siste pris fra ${observation.store_name} (${kr(observation.price)})?`);
    if (!ok) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const response = await authFetch(`/api/products/${productId}/prices/${observation.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke slette pris");
      return;
    }

    setMessage("Prisobservasjonen er slettet.");
    await load();
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [productId]);

  const latest = data?.price_observations?.[0] ?? null;
  const productGroup = data?.product_group ?? null;
  const cheapestGroupPrice = productGroup?.cheapest ?? null;
  const scannedGroupPrice = productGroup?.scanned_product_best_price ?? null;
  const groupSavings = unitSavings(scannedGroupPrice, cheapestGroupPrice);
  const stockTotal = useMemo(() => data?.inventory.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0) ?? 0, [data]);
  const desiredTotal = useMemo(() => {
    const desiredValues = data?.inventory.map((item) => Number(item.desired_quantity ?? 0)) ?? [];
    const desiredFromInventory = Math.max(0, ...desiredValues);
    return desiredFromInventory || Number(data?.product.desired_stock ?? 0);
  }, [data]);

  return (
    <AppShell active="Basisvarer">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/products" className="text-sm font-medium text-brand">← Tilbake til basisvarer</Link>
          <h1 className="mt-3 text-3xl font-bold">Produkt i basisvarer</h1>
          <p className="mt-1 text-muted">Sett målpris, lagergrenser og om produktet skal være med i basisvarene.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/products/${productId}/assessment`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-brand hover:bg-emerald-100">
            AI-vurdering
          </Link>
          <button onClick={syncProduct} disabled={syncing || loading} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">
            {syncing ? "Synker..." : "Synk pris for produkt"}
          </button>
          <button onClick={save} disabled={saving || loading} className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Lagrer..." : "Lagre regler"}
          </button>
        </div>
      </div>

      {message ? <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-brand">{message}</p> : null}
      {error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {loading ? <div className="card mt-6 p-10 text-center text-muted">Henter produkt...</div> : null}

      {data ? (
        <>
          <section className="mt-6 grid grid-cols-[280px_1fr] gap-5">
            <div className="card p-5">
              <div className="grid h-44 place-items-center overflow-hidden rounded-2xl bg-slate-50 text-5xl">
                {data.product.image_url ? <img src={data.product.image_url} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : "🛒"}
              </div>
              <h2 className="mt-4 text-xl font-semibold">{data.product.name}</h2>
              <p className="mt-1 text-sm text-muted">{data.product.brand ?? "Ukjent merke"} · EAN {data.product.ean ?? "mangler"}</p>
              <div className="mt-3 rounded-2xl border border-line bg-white p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pakning</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{packageDisplay(data.product, latest)}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.product.is_basis ? <span className="pill bg-emerald-50 text-brand">Basisvarer</span> : <span className="pill bg-slate-100 text-muted">Ikke basis</span>}
                {data.product.is_freezable ? <span className="pill bg-sky-50 text-sky-700">Kan fryses</span> : null}
                {data.product.category ? <span className="pill bg-slate-50 text-muted">{data.product.category}</span> : null}
              </div>
            </div>

            <div className="grid grid-cols-5 gap-5">
              <StatCard title="Siste pris" value={kr(latest?.price ?? null)} subtitle={latest ? `${latest.store_name} · ${priceSourceLabel(latest.source)}` : "Ingen prisdata"} />
              <StatCard title="Enhetspris" value={unitPriceLabel(latest?.unit_price ?? null, latest?.comparison_unit ?? null)} subtitle={latest ? packageDisplay(data.product, latest) : "Ingen pakningsdata"} tone="purple" />
              <StatCard title="Målpris" value={kr(data.product.target_price)} subtitle={data.product.target_price_unit === "unit_price" ? "Per enhet" : "Per stk/pakke"} tone="amber" />
              <StatCard title="Lager" value={`${stockTotal} / ${desiredTotal}`} subtitle="Faktisk / ønsket" tone={stockTotal < desiredTotal ? "red" : "green"} />
              <StatCard title="Prisobservasjoner" value={String(data.price_observations.length)} subtitle={latest ? `Sist ${shortDateTime(latest.observed_at)} · ${priceSourceLabel(latest.source)}` : "Ingen prisdata"} tone="blue" />
            </div>
          </section>

          {productGroup ? (
            <section className="mt-5 grid grid-cols-[1fr_420px] gap-5">
              <div className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand">Overordnet vare</p>
                    <h2 className="mt-1 text-2xl font-bold">{productGroup.name}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {productGroup.package_count} forpakninger / EAN-varer kan sammenlignes på {unitSuffix(productGroup.comparison_unit)}.
                    </p>
                  </div>
                  {cheapestGroupPrice ? (
                    <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-right">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Beste kjøp nå</p>
                      <p className="mt-1 text-2xl font-bold text-brand">{unitPriceLabel(cheapestGroupPrice.unit_price, cheapestGroupPrice.comparison_unit)}</p>
                      <p className="mt-1 text-sm font-medium text-slate-700">{kr(cheapestGroupPrice.price)} · {cheapestGroupPrice.store_name}</p>
                      <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${currentPriceClass(cheapestGroupPrice)}`}>{currentPriceLabel(cheapestGroupPrice)} · {ageText(cheapestGroupPrice.age_days)}</p>
                    </div>
                  ) : null}
                </div>

                {cheapestGroupPrice ? (
                  <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-brand">Anbefaling</p>
                        <p className="mt-1 text-lg font-bold">{cheapestGroupPrice.product_name}</p>
                        <p className="mt-1 text-sm text-muted">
                          {packageOptionDisplay(cheapestGroupPrice)} · {priceSourceLabel(cheapestGroupPrice.source)}
                        </p>
                        <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${currentPriceClass(cheapestGroupPrice)}`}>{currentPriceLabel(cheapestGroupPrice)} · {ageText(cheapestGroupPrice.age_days)}</p>
                        {groupSavings ? <p className="mt-2 text-sm font-semibold text-brand">{groupSavings} enn denne forpakningen.</p> : null}
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-brand">{unitPriceLabel(cheapestGroupPrice.unit_price, cheapestGroupPrice.comparison_unit)}</p>
                        <p className="text-sm font-semibold text-slate-700">{kr(cheapestGroupPrice.price)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-muted">Ingen trygg nåpris funnet for overordnet vare. Skann hyllepris for å oppdatere.</p>
                )}
              </div>

              <aside className="card p-5">
                <h3 className="font-semibold">Beste forpakninger</h3>
                <div className="mt-4 space-y-2">
                  {(productGroup.price_options ?? []).slice(0, 5).map((option, index) => (
                    <div key={`${option.product_id}:${option.store_code ?? option.store_name}:${option.observed_at ?? index}`} className={`rounded-xl p-3 text-sm ${option.is_scanned_product ? "bg-blue-50" : index === 0 ? "bg-emerald-50" : "bg-slate-50"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{index + 1}. {packageOptionDisplay(option)}</p>
                          <p className="mt-1 truncate text-xs text-muted">{option.store_name} · {priceSourceLabel(option.source)}</p>
                          <p className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${currentPriceClass(option)}`}>{currentPriceLabel(option)} · {ageText(option.age_days)}</p>
                          {option.is_scanned_product ? <p className="mt-1 text-xs font-semibold text-blue-700">Denne forpakningen</p> : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-bold text-brand">{unitPriceLabel(option.unit_price, option.comparison_unit)}</p>
                          <p className="text-xs font-semibold text-slate-500">{kr(option.price)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!productGroup.price_options?.length ? <p className="text-sm text-muted">Ingen aktuelle alternativer de siste 45 dagene.</p> : null}
                </div>
              </aside>
            </section>
          ) : null}

          <div className="mt-6 grid grid-cols-[1fr_420px] gap-5">
            <section className="card p-5">
              <h2 className="text-lg font-semibold">Basisvarer, regler og målpris</h2>
              <p className="mt-1 text-sm text-muted">Når Basisvarer er på, brukes varen i lager, anbefalinger og automatisk handleliste. Slå av for å fjerne den fra basisvarene uten å slette produktet.</p>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <label className="space-y-1 text-sm"><span className="font-medium">Produktnavn</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.name ?? "")} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Merke</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.brand ?? "")} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Kategori</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="Hygiene, Italiensk, Meieri..." value={String(form.category ?? "")} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Pakningsstørrelse</span><input className="w-full rounded-xl border border-line px-3 py-2" value={String(form.package_size ?? "")} onChange={(e) => setForm({ ...form, package_size: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Målpris</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-2" value={String(form.target_price ?? "")} onChange={(e) => setForm({ ...form, target_price: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Målpris-type</span><select className="w-full rounded-xl border border-line px-3 py-2" value={String(form.target_price_unit ?? "unit")} onChange={(e) => setForm({ ...form, target_price_unit: e.target.value })}><option value="unit">Per stk/pakke</option><option value="unit_price">Per kg/l/enhet</option></select></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Ønsket lager</span><input type="number" step="1" className="w-full rounded-xl border border-line px-3 py-2" value={String(form.desired_stock ?? "")} onChange={(e) => setForm({ ...form, desired_stock: e.target.value })} /></label>
                <label className="space-y-1 text-sm"><span className="font-medium">Foretrukket butikk</span><input className="w-full rounded-xl border border-line px-3 py-2" placeholder="KIWI, Oda, MENY..." value={String(form.preferred_store ?? "")} onChange={(e) => setForm({ ...form, preferred_store: e.target.value })} /></label>
              </div>

              <div className="mt-5 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2"><input type="checkbox" checked={Boolean(form.is_basis)} onChange={(e) => setForm({ ...form, is_basis: e.target.checked })} /> Med i basisutvalg</label>
                <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2"><input type="checkbox" checked={Boolean(form.is_freezable)} onChange={(e) => setForm({ ...form, is_freezable: e.target.checked })} /> Kan fryses</label>
              </div>

              <label className="mt-5 block space-y-1 text-sm"><span className="font-medium">Notater / regel</span><textarea className="min-h-28 w-full rounded-xl border border-line px-3 py-2" value={String(form.notes ?? "")} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Eksempel: Kjøp OMO under 50 kr når lager <= 1." /></label>
              <section className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
                <h3 className="font-semibold">Produktdata fra Kassalapp</h3>
                <div className="mt-3 space-y-3 text-sm">
                  {data.product.category_path?.length ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Kategori</p><p>{data.product.category_path.join(" › ")}</p></div>
                  ) : null}
                  {data.product.description ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Beskrivelse</p><p>{data.product.description}</p></div>
                  ) : null}
                  {data.product.ingredients ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Ingredienser</p><p>{data.product.ingredients}</p></div>
                  ) : null}
                  {shortJson(data.product.allergens) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Allergener</p><p>{shortJson(data.product.allergens)}</p></div>
                  ) : null}
                  {shortJson(data.product.nutrition) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Næring</p><p>{shortJson(data.product.nutrition)}</p></div>
                  ) : null}
                  {shortJson(data.product.labels) ? (
                    <div><p className="text-xs uppercase tracking-wide text-muted">Merking</p><p>{shortJson(data.product.labels)}</p></div>
                  ) : null}
                  {!data.product.description && !data.product.ingredients && !data.product.allergens && !data.product.nutrition && !data.product.labels && !data.product.category_path?.length ? (
                    <p className="text-muted">Ingen ekstra produktdata lagret ennå. Trykk Synk pris for produkt.</p>
                  ) : null}
                </div>
              </section>

            </section>

            <aside className="space-y-5">
              <section className="card p-5">
                <h2 className="font-semibold">Siste prisregistreringer</h2>
                <p className="mt-1 text-sm text-muted">Produktet viser siste opplastede pris. Admin kan korrigere eller slette feil pris.</p>
                <div className="mt-4 space-y-2">
                  {data.price_observations.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.store_name}</p>
                          <p className="text-xs text-muted">{shortDateTime(item.observed_at)} · {priceSourceLabel(item.source)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-brand">{kr(item.price)}</p>
                          <p className="text-xs font-semibold text-muted">{unitPriceLabel(item.unit_price, item.comparison_unit)}</p>
                          <p className="text-[11px] font-medium text-slate-400">{packageDisplay(data.product, item)}</p>
                          {item.unit_price_was_corrected ? <p className="mt-1 text-[11px] font-semibold text-amber-700">Korrigert fra pakning</p> : null}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => editPriceObservation(item)} className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-slate-700">
                          Endre
                        </button>
                        <button type="button" onClick={() => deletePriceObservation(item)} className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700">
                          Slett
                        </button>
                      </div>
                    </div>
                  ))}
                  {!data.price_observations.length ? <p className="text-sm text-muted">Ingen prisobservasjoner ennå.</p> : null}
                </div>
              </section>

              <section className="card p-5">
                <h2 className="font-semibold">Lagerlinjer</h2>
                <div className="mt-4 space-y-2">
                  {data.inventory.map((item) => (
                    <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between"><span className="font-medium">{item.location}</span><span>{item.quantity} / {item.desired_quantity}</span></div>
                      <p className="mt-1 text-xs text-muted">Oppdatert {shortDate(item.updated_at)}</p>
                    </div>
                  ))}
                  {!data.inventory.length ? <p className="text-sm text-muted">Ingen lagerlinje ennå. Lagre regler for å opprette en.</p> : null}
                </div>
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
