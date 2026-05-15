"use client";

import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useMemo, useState } from "react";
import { AppShell, StatCard } from "@/components/app-shell";
import { kr } from "@/lib/utils";

type ProductOption = {
  id: string;
  name: string;
  brand: string | null;
  latest_price?: number | null;
  latest_store?: string | null;
};

type Purchase = {
  id: string;
  store_name: string;
  receipt_no: string | null;
  purchased_at: string;
  total_amount: number | null;
  trumf_bonus: number | null;
  source: string | null;
  items: Array<{
    id: string;
    raw_name: string;
    quantity: number;
    unit: string | null;
    paid_price: number;
  }>;
};

function todayLocal() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function shortDate(value?: string | null) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export default function PurchasesPage() {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [storeName, setStoreName] = useState("KIWI");
  const [purchasedAt, setPurchasedAt] = useState(todayLocal());
  const [receiptNo, setReceiptNo] = useState("");
  const [trumfBonus, setTrumfBonus] = useState("");
  const [productId, setProductId] = useState("");
  const [rawName, setRawName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [paidPrice, setPaidPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProducts() {
    const response = await authFetch("/api/products", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok) setProducts(payload?.data ?? []);
  }

  async function loadPurchases() {
    const response = await authFetch("/api/purchases", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      setPurchases(payload?.data ?? []);
      return;
    }
    setError(payload?.error ?? "Kunne ikke hente kjøp");
  }

  async function savePurchase() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const selected = products.find((product) => product.id === productId);
    const response = await authFetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_name: storeName,
        purchased_at: purchasedAt,
        receipt_no: receiptNo || null,
        trumf_bonus: trumfBonus || 0,
        items: [
          {
            product_id: productId || null,
            raw_name: rawName || selected?.name || "Ukjent vare",
            quantity,
            unit: "stk",
            paid_price: paidPrice
          }
        ]
      })
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setError(payload?.error ?? "Kunne ikke lagre kjøp");
      return;
    }

    setMessage(`Kjøp lagret.${payload?.warnings?.length ? ` Advarsel: ${payload.warnings.join(", ")}` : ""}`);
    setRawName("");
    setQuantity("1");
    setPaidPrice("");
    await loadPurchases();
  }

  useEffect(() => {
    loadProducts().catch(() => undefined);
    loadPurchases().catch(() => undefined);
  }, []);

  const totalAmount = useMemo(() => purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount ?? 0), 0), [purchases]);
  const itemCount = useMemo(() => purchases.reduce((sum, purchase) => sum + purchase.items.length, 0), [purchases]);
  const selectedProduct = products.find((product) => product.id === productId);

  return (
    <AppShell active="Kjøp">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="page-heading">Kjøp og kvitteringer</h1>
          <p className="page-subtitle">Registrer enkle kjøp manuelt. Dette bygger forbrukshistorikk og oppdaterer lager.</p>
        </div>
        <a href="/inventory" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-slate-700">Se lager</a>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <StatCard title="Registrerte kjøp" value={String(purchases.length)} subtitle="Siste 30 vises" />
        <StatCard title="Varelinjer" value={String(itemCount)} subtitle="Manuelt registrert" tone="blue" />
        <StatCard title="Beløp" value={kr(totalAmount)} subtitle="På registrerte kjøp" tone="amber" />
        <StatCard title="Produkter" value={String(products.length)} subtitle="Kan kobles til varelinjer" tone="purple" />
      </div>

      {message ? <p className="notice-success mt-5">{message}</p> : null}
      {error ? <p className="notice-error mt-5">{error}</p> : null}

      <div className="mt-6 grid grid-cols-[440px_1fr] gap-5">
        <section className="card p-5">
          <h2 className="section-title">Legg inn kjøp</h2>
          <p className="section-subtitle">Første versjon støtter én varelinje om gangen. Bruk dette for å bygge historikk raskt.</p>

          <div className="mt-5 space-y-4">
            <label className="block space-y-1 text-sm"><span className="font-medium">Butikk</span><input className="w-full rounded-xl border border-line px-3 py-2" value={storeName} onChange={(e) => setStoreName(e.target.value)} /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium">Dato/tid</span><input type="datetime-local" className="w-full rounded-xl border border-line px-3 py-2" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium">Kvitteringsnr. valgfritt</span><input className="w-full rounded-xl border border-line px-3 py-2" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} /></label>
            <label className="block space-y-1 text-sm"><span className="font-medium">Koble til produkt</span><select className="w-full rounded-xl border border-line px-3 py-2" value={productId} onChange={(e) => { setProductId(e.target.value); const product = products.find((p) => p.id === e.target.value); if (product) { setRawName(product.name); if (!paidPrice && product.latest_price) setPaidPrice(String(product.latest_price)); } }}><option value="">Ikke koblet</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
            <label className="block space-y-1 text-sm"><span className="font-medium">Varenavn på kvittering</span><input className="w-full rounded-xl border border-line px-3 py-2" value={rawName} onChange={(e) => setRawName(e.target.value)} placeholder={selectedProduct?.name ?? "F.eks. OMO Ultra Hvitt"} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-sm"><span className="font-medium">Antall</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-2" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
              <label className="block space-y-1 text-sm"><span className="font-medium">Betalt pris</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-2" value={paidPrice} onChange={(e) => setPaidPrice(e.target.value)} /></label>
            </div>
            <label className="block space-y-1 text-sm"><span className="font-medium">Trumf-bonus valgfritt</span><input type="number" step="0.01" className="w-full rounded-xl border border-line px-3 py-2" value={trumfBonus} onChange={(e) => setTrumfBonus(e.target.value)} /></label>
            <button onClick={savePurchase} disabled={saving} className="w-full rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Lagrer..." : "Lagre kjøp og oppdater lager"}</button>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-line p-5">
            <h2 className="section-title">Siste kjøp</h2>
            <p className="text-sm leading-6 text-muted">Bruk denne som enkel forbrukshistorikk før full kvitteringsimport.</p>
          </div>
          <div className="divide-y divide-line">
            {purchases.map((purchase) => (
              <article key={purchase.id} className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 className="font-semibold">{purchase.store_name}</h3><p className="text-sm leading-6 text-muted">{shortDate(purchase.purchased_at)} {purchase.receipt_no ? `· ${purchase.receipt_no}` : ""}</p></div>
                  <p className="text-lg font-bold text-brand">{kr(purchase.total_amount)}</p>
                </div>
                <div className="mt-3 space-y-2">
                  {purchase.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>{item.raw_name} · {item.quantity} {item.unit ?? "stk"}</span><b>{kr(item.paid_price)}</b></div>
                  ))}
                </div>
              </article>
            ))}
            {!purchases.length ? <div className="p-10 text-center text-muted">Ingen kjøp registrert ennå.</div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
