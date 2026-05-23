"use client";

import { authFetch } from "@/lib/auth-fetch";
import { AppShell } from "@/components/app-shell";
import { kr } from "@/lib/utils";
import { AlertTriangle, Apple, BadgeCheck, Barcode, Beef, ChevronLeft, CircleHelp, Egg, Leaf, Milk, Package, ScanLine, ShieldAlert, Sparkles, Tags, Wheat } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Assessment = {
  product: string;
  brand: string;
  ean: string;
  category: string;
  type: string;
  image_url: string;
  allergens: string[];
  contains_milk_protein: "ja" | "nei" | "ukjent";
  contains_gluten: "ja" | "nei" | "ukjent";
  contains_egg: "ja" | "nei" | "ukjent";
  contains_lactose: "ja" | "nei" | "lite" | "ukjent";
  contains_nuts: "ja" | "nei" | "spor" | "ukjent";
  contains_soy: "ja" | "nei" | "spor" | "ukjent";
  organic: "ja" | "nei" | "ukjent";
  origin: string;
  ingredients: string;
  e_additives_count: number;
  e_additives: Array<{ code: string; name: string; type: string; risk_level: "lav" | "moderat" | "høy" | "ukjent"; explanation: string }>;
  processing_level: "minimalt prosessert" | "prosessert" | "ultraprosessert" | "ukjent";
  nova_class: "1" | "2" | "3" | "4" | "ukjent";
  nutrition_per_100g: Record<"energy_kcal" | "fat_g" | "saturated_fat_g" | "carbs_g" | "sugars_g" | "fiber_g" | "protein_g" | "salt_g" | "protein_per_100kcal_g", number | null>;
  price: { price_nok: number | null; price_per_kg_l: number | null; source: string };
  health_score: number;
  health_score_label: string;
  value_score: number;
  value_score_label: string;
  use_frequency: "daglig" | "ofte" | "av og til" | "sjelden" | "ukjent";
  quick_badges: string[];
  pros: string[];
  cons: string[];
  important_notes: string[];
  better_alternatives: Array<{ name: string; reason: string; health_score: number | null }>;
  short_summary: string;
  long_summary: string;
  confidence: number;
  missing_data: string[];
  sources: string[];
};

type ProductDetail = {
  product: {
    id: string;
    name: string;
    brand: string | null;
    ean: string | null;
    category: string | null;
    package_size: string | null;
    image_url: string | null;
  };
  price_observations: Array<{ price: number; unit_price: number | null; store_name: string; observed_at: string; source: string | null }>;
};

type AssessmentResponse = {
  data?: { assessment: Assessment; generatedAt: string };
  error?: string;
};

type ProductResponse = {
  data?: ProductDetail;
  error?: string;
};

const unknown = "Ikke oppgitt";

function scoreTone(score: number) {
  if (score >= 80) return { ring: "from-emerald-500 to-green-400", bg: "bg-emerald-50", text: "text-emerald-700", bar: "bg-emerald-600" };
  if (score >= 60) return { ring: "from-lime-500 to-emerald-400", bg: "bg-lime-50", text: "text-lime-700", bar: "bg-lime-600" };
  if (score >= 40) return { ring: "from-amber-400 to-yellow-300", bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-500" };
  if (score >= 20) return { ring: "from-orange-500 to-amber-400", bg: "bg-orange-50", text: "text-orange-700", bar: "bg-orange-500" };
  return { ring: "from-rose-600 to-red-400", bg: "bg-rose-50", text: "text-rose-700", bar: "bg-rose-600" };
}

function badgeTone(value: string) {
  const normalized = value.toLowerCase();
  if (["nei", "0", "lav", "minimalt prosessert", "1"].includes(normalized)) return "border-emerald-100 bg-emerald-50 text-emerald-800";
  if (["ukjent", "ikke oppgitt"].includes(normalized)) return "border-slate-200 bg-slate-50 text-slate-600";
  if (normalized.includes("høy") || normalized.includes("ja") || normalized.includes("ultra") || normalized === "4") return "border-rose-100 bg-rose-50 text-rose-800";
  return "border-amber-100 bg-amber-50 text-amber-800";
}

function fmt(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return unknown;
  return `${String(value).replace(".", ",")}${suffix}`;
}

function shortDate(value?: string | null) {
  if (!value) return unknown;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function countryCodeToFlag(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  return normalized
    .split("")
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join("");
}

const ORIGIN_FLAG_HINTS: Array<[RegExp, string]> = [
  [/\bnorge\b|\bnorway\b|\bnorsk\b|\bNO\b/i, "NO"],
  [/\bsverige\b|\bsweden\b|\bSE\b/i, "SE"],
  [/\bdanmark\b|\bdenmark\b|\bDK\b/i, "DK"],
  [/\bfinland\b|\bFI\b/i, "FI"],
  [/\bisland\b|\biceland\b|\bIS\b/i, "IS"],
  [/\btyskland\b|\bgermany\b|\bDE\b/i, "DE"],
  [/\bfrankrike\b|\bfrance\b|\bFR\b/i, "FR"],
  [/\bitalia\b|\bitaly\b|\bIT\b/i, "IT"],
  [/\bspania\b|\bspain\b|\bES\b/i, "ES"],
  [/\bnederland\b|\bnetherlands\b|\bNL\b/i, "NL"],
  [/\bbelgia\b|\bbelgium\b|\bBE\b/i, "BE"],
  [/\bpolen\b|\bpoland\b|\bPL\b/i, "PL"],
  [/\bstorbritannia\b|\bunited kingdom\b|\buk\b|\bGB\b/i, "GB"],
  [/\birland\b|\bireland\b|\bIE\b/i, "IE"],
  [/\busa\b|\bunited states\b|\bUS\b/i, "US"],
  [/\bcanada\b|\bCA\b/i, "CA"],
  [/\bbrasil\b|\bbrazil\b|\bBR\b/i, "BR"],
  [/\bargentina\b|\bAR\b/i, "AR"],
  [/\bchile\b|\bCL\b/i, "CL"],
  [/\bperu\b|\bPE\b/i, "PE"],
  [/\bmarokko\b|\bmorocco\b|\bMA\b/i, "MA"],
  [/\bkenya\b|\bKE\b/i, "KE"],
  [/\bsor-afrika\b|\bsouth africa\b|\bZA\b/i, "ZA"],
  [/\bkina\b|\bchina\b|\bCN\b/i, "CN"],
  [/\bindia\b|\bIN\b/i, "IN"],
  [/\bthailand\b|\bTH\b/i, "TH"],
  [/\bvietnam\b|\bVN\b/i, "VN"]
];

function originFlag(origin?: string | null) {
  const value = String(origin ?? "").trim();
  if (!value || ["ukjent", "ikke oppgitt", "unknown", "null"].includes(value.toLowerCase())) return null;

  for (const [pattern, code] of ORIGIN_FLAG_HINTS) {
    if (pattern.test(value)) return countryCodeToFlag(code);
  }

  return null;
}

function hasKnownOrigin(origin?: string | null) {
  return Boolean(originFlag(origin));
}

function ScoreCard({ title, score, label, helper }: { title: string; score: number; label: string; helper: string }) {
  const tone = scoreTone(score);
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        <CircleHelp size={18} className="text-muted" />
      </div>
      <div className="mt-5 flex items-end gap-2">
        <span className={`text-6xl font-black tracking-tight ${tone.text}`}>{safeScore}</span>
        <span className="mb-2 text-2xl font-bold text-slate-800">/100</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-800">{label || unknown}</p>
      <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${safeScore}%` }} />
      </div>
      <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-muted">{helper}</p>
    </div>
  );
}

function QuickBadge({ icon: Icon, title, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; value: string | number }) {
  const stringValue = String(value || unknown);
  return (
    <div className={`rounded-2xl border p-4 ${badgeTone(stringValue)}`}>
      <Icon size={22} className="mb-3" />
      <p className="text-xs font-black uppercase tracking-wide opacity-70">{title}</p>
      <p className="mt-1 text-sm font-bold leading-5">{stringValue}</p>
    </div>
  );
}

function InfoCard({ title, children, icon: Icon }: { title: string; children: React.ReactNode; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand"><Icon size={18} /></span>
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function FoodAssessmentPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProduct() {
    setLoading(true);
    setError(null);
    const response = await authFetch(`/api/products/${productId}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as ProductResponse | null;
    setLoading(false);

    if (!response.ok || !payload?.data) {
      setError(payload?.error ?? "Kunne ikke hente produkt");
      return;
    }

    setDetail(payload.data);
  }

  async function runAssessment() {
    setAssessing(true);
    setError(null);
    const response = await authFetch(`/api/products/${productId}/assessment`, { method: "POST" });
    const payload = (await response.json().catch(() => null)) as AssessmentResponse | null;
    setAssessing(false);

    if (!response.ok || !payload?.data) {
      setError(payload?.error ?? "Kunne ikke lage AI-vurdering");
      return;
    }

    setAssessment(payload.data.assessment);
    setGeneratedAt(payload.data.generatedAt);
  }

  useEffect(() => {
    loadProduct().catch(() => undefined);
  }, [productId]);

  const product = assessment ?? null;
  const header = product ?? detail?.product;
  const latest = detail?.price_observations?.[0] ?? null;

  const nutritionCards = useMemo(() => {
    if (!assessment) return [];
    const n = assessment.nutrition_per_100g;
    return [
      ["Kalorier", fmt(n.energy_kcal, " kcal")],
      ["Fett", fmt(n.fat_g, " g")],
      ["Mettet fett", fmt(n.saturated_fat_g, " g")],
      ["Protein", fmt(n.protein_g, " g")],
      ["Karbohydrat", fmt(n.carbs_g, " g")],
      ["Sukkerarter", fmt(n.sugars_g, " g")],
      ["Fiber", fmt(n.fiber_g, " g")],
      ["Salt", fmt(n.salt_g, " g")],
      ["Protein/100 kcal", fmt(n.protein_per_100kcal_g, " g")]
    ];
  }, [assessment]);

  const hasNutritionData = useMemo(() => {
    return nutritionCards.some(([, value]) => value !== unknown);
  }, [nutritionCards]);

  return (
    <AppShell active="Basisvarer">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <Link href={`/products/${productId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand"><ChevronLeft size={16} /> Tilbake til produkt</Link>
          <h1 className="page-heading mt-3">AI-matvarevurdering</h1>
          <p className="page-subtitle">Søk/produktdata, pris og ingredienser brukes til en lettlest vurdering. Vurderingen er veiledende og ikke medisinsk rådgivning.</p>
        </div>
        <button onClick={runAssessment} disabled={assessing || loading} className="btn-primary gap-2">
          <Sparkles size={18} /> {assessing ? "Vurderer..." : assessment ? "Kjør ny AI-vurdering" : "Lag AI-vurdering"}
        </button>
      </div>

      {error ? <p className="notice-error mt-5">{error}</p> : null}
      {loading ? <div className="card mt-6 p-10 text-center text-muted">Henter produkt...</div> : null}

      {header ? (
        <section className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_1fr]">
          <div className="card p-5">
            <div className="grid gap-5 md:grid-cols-[230px_1fr]">
              <div className="grid h-56 place-items-center overflow-hidden rounded-3xl bg-slate-50 text-6xl">
                {(product?.image_url || detail?.product.image_url) ? <img src={product?.image_url || detail?.product.image_url || ""} alt="" className="h-full w-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : "🛒"}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Produkt</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{product?.product ?? detail?.product.name}</h2>
                <p className="mt-2 text-muted">{product?.brand ?? detail?.product.brand ?? unknown}</p>
                <div className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p><span className="font-semibold">EAN:</span> {product?.ean ?? detail?.product.ean ?? unknown}</p>
                  <p><span className="font-semibold">Kategori:</span> {product?.category ?? detail?.product.category ?? unknown}</p>
                  <p><span className="font-semibold">Type:</span> {product?.type ?? detail?.product.package_size ?? unknown}</p>
                  <p><span className="font-semibold">Sist vurdert:</span> {shortDate(generatedAt)}</p>
                </div>
                {hasKnownOrigin(product?.origin) ? (
                  <div className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
                    <span className="text-3xl leading-none" aria-hidden="true">{originFlag(product?.origin)}</span>
                    <span>
                      <span className="block text-xs uppercase tracking-wide text-emerald-700">Opprinnelse</span>
                      {product?.origin}
                    </span>
                  </div>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                  {(assessment?.quick_badges ?? []).slice(0, 5).map((badge) => <span key={badge} className="pill bg-emerald-50 text-brand">{badge}</span>)}
                </div>
              </div>
            </div>
          </div>

          {assessment ? (
            <div className="grid gap-5 md:grid-cols-2">
              <ScoreCard title="Sunnhetsscore" score={assessment.health_score} label={assessment.health_score_label} helper="Basert på ingredienser, næring, prosessering og allergeninformasjon." />
              <ScoreCard title="Pris/nytte-score" score={assessment.value_score} label={assessment.value_score_label} helper="Vurderer pris mot næring, bruksverdi og produktkategori." />
            </div>
          ) : (
            <div className="card grid place-items-center p-10 text-center">
              <div>
                <Sparkles size={42} className="mx-auto text-brand" />
                <h2 className="mt-3 text-xl font-bold">Klar for AI-vurdering</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">Trykk på knappen for å analysere produktet med ingredienser, næringsdata, pris og kategori.</p>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {assessment ? (
        <>
          <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-10">
            <QuickBadge icon={ShieldAlert} title="Allergener" value={assessment.allergens.length ? assessment.allergens.join(", ") : "Ingen oppgitt"} />
            <QuickBadge icon={Milk} title="Melkeprotein" value={assessment.contains_milk_protein} />
            <QuickBadge icon={Wheat} title="Gluten" value={assessment.contains_gluten} />
            <QuickBadge icon={Egg} title="Egg" value={assessment.contains_egg} />
            <QuickBadge icon={Milk} title="Laktose" value={assessment.contains_lactose} />
            <QuickBadge icon={Leaf} title="Økologisk" value={assessment.organic} />
            <QuickBadge icon={AlertTriangle} title="E-stoffer" value={String(assessment.e_additives_count)} />
            <QuickBadge icon={Package} title="Prosessering" value={assessment.processing_level} />
            <QuickBadge icon={BadgeCheck} title="NOVA" value={assessment.nova_class} />
            <QuickBadge icon={Apple} title="Bruk" value={assessment.use_frequency} />
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.2fr_0.75fr_1fr]">
            <InfoCard title="Ingredienser" icon={ScanLine}>
              <p className="text-sm leading-6 text-slate-700">{assessment.ingredients || unknown}</p>
              {assessment.e_additives.length ? (
                <div className="mt-4 space-y-2">
                  {assessment.e_additives.slice(0, 4).map((item) => (
                    <div key={`${item.code}-${item.name}`} className={`rounded-xl border p-3 text-sm ${badgeTone(item.risk_level)}`}>
                      <p className="font-bold">{item.code} {item.name}</p>
                      <p className="text-xs leading-5 opacity-80">{item.type} · {item.explanation}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-4 text-sm text-brand">Ingen E-stoffer oppgitt.</p>}
            </InfoCard>

            {hasNutritionData ? (
              <InfoCard title="Ernæringsprofil per 100 g" icon={Beef}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {nutritionCards.map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs text-muted">{label}</p>
                      <p className="mt-1 font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              </InfoCard>
            ) : null}

            <InfoCard title="Pris" icon={Tags}>
              <p className="text-sm text-muted">Ca. pris</p>
              <p className="mt-1 text-3xl font-black text-brand">{kr(assessment.price.price_nok ?? latest?.price ?? null)}</p>
              <p className="mt-3 text-sm text-muted">Pris per kg/l</p>
              <p className="font-bold">{assessment.price.price_per_kg_l ? kr(assessment.price.price_per_kg_l) : latest?.unit_price ? kr(latest.unit_price) : unknown}</p>
              <p className="mt-3 text-xs text-muted">Kilde: {assessment.price.source || latest?.source || unknown}</p>
            </InfoCard>

            <InfoCard title="AI-oppsummering" icon={Sparkles}>
              <p className="text-sm leading-6 text-slate-800">{assessment.short_summary}</p>
              <p className="mt-4 text-xs leading-5 text-muted">Confidence: {Math.round(assessment.confidence * 100)} %. Mangler: {assessment.missing_data.length ? assessment.missing_data.join(", ") : "ingen store hull"}.</p>
            </InfoCard>
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.8fr_1fr]">
            <InfoCard title="Bedre alternativer" icon={Apple}>
              <div className="space-y-3">
                {assessment.better_alternatives.length ? assessment.better_alternatives.map((alt) => (
                  <div key={alt.name} className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
                    <p className="font-bold text-slate-900">{alt.name}</p>
                    <p className="mt-1 text-sm leading-5 text-slate-700">{alt.reason}</p>
                    {alt.health_score !== null ? <p className="mt-2 text-xs font-bold text-amber-800">Score ca. {alt.health_score}/100</p> : null}
                  </div>
                )) : <p className="text-sm text-muted">Ingen konkrete alternativer funnet.</p>}
              </div>
            </InfoCard>

            <InfoCard title="Kilder" icon={Barcode}>
              <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
                {assessment.sources.length ? assessment.sources.map((source) => <li key={source}>{source}</li>) : <li>{unknown}</li>}
              </ul>
              <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-muted">Vurderingen skiller mellom lagrede produktdata og AI-tolkning. Les alltid produktets merking ved allergi.</p>
            </InfoCard>

            <InfoCard title="Viktige vurderingspunkter" icon={AlertTriangle}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <p className="text-sm font-bold text-brand">Pluss</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">{assessment.pros.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <p className="text-sm font-bold text-rose-700">Obs</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">{assessment.cons.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>
              {assessment.important_notes.length ? (
                <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
                  {assessment.important_notes.map((note) => <p key={note}>• {note}</p>)}
                </div>
              ) : null}
            </InfoCard>
          </section>

          <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
            <strong>Viktig:</strong> Vurderingen er generert av AI basert på tilgjengelige data og er veiledende, ikke medisinsk rådgivning. Opplysninger kan være ufullstendige eller feil. Les alltid produktets varemerking.
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
