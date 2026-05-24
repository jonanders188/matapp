"use client";

export function displayUnitSuffix(unit: string | null | undefined) {
  if (unit === "kg") return "kg";
  if (unit === "l") return "l";
  if (unit === "stk") return "stk";
  return "enhet";
}

type StoreBranding = {
  label: string;
  logoPath: string | null;
  textClassName: string;
};

function normalizeStoreBrand(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function storeBranding(storeKey: string | null | undefined, storeName: string | null | undefined): StoreBranding {
  const key = normalizeStoreBrand(storeKey || storeName);

  if (key.includes("kiwi")) return { label: "KIWI", logoPath: "/store-logos/kiwi.svg", textClassName: "text-lime-600" };
  if (key.includes("meny")) return { label: "MENY", logoPath: "/store-logos/meny.svg", textClassName: "text-red-600" };
  if (key.includes("rema")) return { label: "REMA 1000", logoPath: "/store-logos/rema-1000.svg", textClassName: "text-blue-700" };
  if (key.includes("extra")) return { label: "EXTRA", logoPath: "/store-logos/extra.svg", textClassName: "text-red-600" };
  if (key.includes("coop_mega") || key.includes("coop mega")) return { label: "COOP MEGA", logoPath: "/store-logos/coop-mega.svg", textClassName: "text-sky-600" };
  if (key.includes("obs")) return { label: "OBS", logoPath: "/store-logos/obs.svg", textClassName: "text-orange-600" };
  if (key.includes("spar")) return { label: "SPAR", logoPath: "/store-logos/spar.svg", textClassName: "text-emerald-700" };
  if (key.includes("bunnpris")) return { label: "BUNNPRIS", logoPath: "/store-logos/bunnpris.svg", textClassName: "text-blue-800" };
  if (key.includes("oda")) return { label: "ODA", logoPath: "/store-logos/oda.svg", textClassName: "text-violet-700" };

  return { label: storeName || storeKey || "Butikk", logoPath: null, textClassName: "text-slate-800" };
}

export function StoreLogoBadge({
  storeKey,
  storeName,
  compact = false,
}: {
  storeKey?: string | null;
  storeName?: string | null;
  compact?: boolean;
}) {
  const brand = storeBranding(storeKey ?? null, storeName ?? null);
  const shellClassName = compact ? "h-10 min-w-[6.25rem] rounded-2xl px-2.5" : "h-14 min-w-[8rem] rounded-[1.25rem] px-3";

  if (!brand.logoPath) {
    return (
      <span
        title={brand.label}
        aria-label={brand.label}
        className={`inline-flex items-center justify-center border border-slate-200 bg-white ${shellClassName}`}
      >
        <span className={`truncate text-center text-sm font-black uppercase tracking-[0.12em] ${brand.textClassName}`}>
          {brand.label}
        </span>
      </span>
    );
  }

  return (
    <span
      title={brand.label}
      aria-label={brand.label}
      className={`inline-flex items-center justify-center border border-slate-200 bg-white ${shellClassName}`}
    >
      <img
        src={brand.logoPath}
        alt={brand.label}
        className="h-[84%] w-[92%] object-contain object-center"
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
