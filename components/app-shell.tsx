"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Box,
  Database,
  PackageSearch,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tags
} from "lucide-react";
import { cx } from "@/lib/utils";
import { AuthStatus } from "@/components/auth-status";
import { authFetch } from "@/lib/auth-fetch";

type HouseholdSummary = {
  id: string;
  name: string;
  role: "admin" | "member";
  display_name: string | null;
};

type AccessState = {
  loading: boolean;
  canUseApp: boolean;
  canManageHousehold: boolean;
  canAccessSystemAdmin: boolean;
  activeHousehold: HouseholdSummary | null;
  households: HouseholdSummary[];
};

type NavAudience = "member" | "household-admin" | "system-admin";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  aliases?: string[];
  description?: string;
  audience?: NavAudience;
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: "Daglig bruk",
    items: [
      { label: "Lager", href: "/inventory", icon: Box, aliases: ["Inventory"], description: "Beholdning hjemme" },
      { label: "Prisoversikt", href: "/prices", icon: Tags, aliases: ["Priser", "Prissammenligning"], description: "Nåpris på basisvarer" },
      { label: "Bygg basis", href: "/mobile2", icon: Smartphone, aliases: ["Kvittering", "Mobile2", "Mobil lager", "Skann kvittering"], description: "Skann hjemmevarer uten pris" },
      { label: "Skann pris", href: "/mobile", icon: Smartphone, aliases: ["Mobile", "Mobil butikk", "Skann produkt"], description: "Oppdater butikkpris når du vil" }
    ]
  },
  {
    title: "Varer",
    items: [
      { label: "Kom i gang", href: "/onboarding", icon: Sparkles, aliases: ["Onboarding", "Veiviser"], description: "Skann lager først" },
      { label: "Basisvarer", href: "/products", icon: PackageSearch, aliases: ["Basisutvalg", "Produkter"], description: "Ditt faste vareutvalg" },
      { label: "Legg til varer", href: "/catalog", icon: Database, aliases: ["Produktregister", "Katalog"], description: "Finn flere varer" }
    ]
  },
  {
    title: "Oppsett",
    items: [
      { label: "Admin", href: "/admin", icon: Settings, aliases: ["Innstillinger", "Oppsett", "Integrasjoner"], description: "Husholdning og butikker", audience: "household-admin" },
      { label: "Systemadmin", href: "/admin/product-groups", icon: ShieldCheck, aliases: ["Produktgrupper", "System Admin"], description: "Globale produktgrupper", audience: "system-admin" }
    ]
  }
];

const quickActions = [
  { label: "Bygg basis", href: "/mobile2" },
  { label: "Skann pris", href: "/mobile" },
  { label: "Kom i gang", href: "/onboarding" }
] as const;

function emptyAccess(): AccessState {
  return {
    loading: true,
    canUseApp: false,
    canManageHousehold: false,
    canAccessSystemAdmin: false,
    activeHousehold: null,
    households: []
  };
}

function isActive(item: NavItem, active: string) {
  return item.label === active || item.aliases?.includes(active);
}

function canSeeItem(item: NavItem, access: AccessState) {
  if (item.audience === "system-admin") return access.canAccessSystemAdmin;
  if (item.audience === "household-admin") return access.canManageHousehold;
  return access.canUseApp;
}

function activeRequiresHouseholdAdmin(active: string) {
  return ["Admin", "Innstillinger", "Oppsett", "Integrasjoner"].includes(active);
}

function activeRequiresSystemAdmin(active: string) {
  return ["Systemadmin", "Produktgrupper", "System Admin"].includes(active);
}

function roleLabel(role: HouseholdSummary["role"] | null | undefined) {
  return role === "admin" ? "Eier/admin" : "Medlem";
}

function AccessDenied({ title, message }: { title: string; message: string }) {
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Ingen tilgang</p>
      <h1 className="mt-2 text-2xl font-black">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm font-semibold text-amber-900">{message}</p>
      <Link href="/dashboard" className="mt-5 inline-flex rounded-2xl bg-white px-4 py-3 text-sm font-black text-amber-900 ring-1 ring-amber-200">
        Til forsiden
      </Link>
    </section>
  );
}

export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
  const [access, setAccess] = useState<AccessState>(emptyAccess);

  useEffect(() => {
    let cancelled = false;

    authFetch("/api/me/access")
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          data?: {
            household?: HouseholdSummary | null;
            households?: HouseholdSummary[];
            requestedHouseholdWasInvalid?: boolean;
            capabilities?: { canUseApp?: boolean; canManageHousehold?: boolean; canAccessSystemAdmin?: boolean };
          };
          error?: string;
        } | null;

        if (cancelled) return;

        if (response.status === 401) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.assign(`/login?next=${next}`);
          return;
        }

        const activeHousehold = payload?.data?.household ?? null;
        const households = payload?.data?.households ?? [];

        if (typeof window !== "undefined") {
          if (activeHousehold) {
            window.localStorage.setItem("matmakt.activeHouseholdId", activeHousehold.id);
          } else if (payload?.data?.requestedHouseholdWasInvalid) {
            window.localStorage.removeItem("matmakt.activeHouseholdId");
          }
        }

        setAccess({
          loading: false,
          canUseApp: Boolean(payload?.data?.capabilities?.canUseApp),
          canManageHousehold: Boolean(payload?.data?.capabilities?.canManageHousehold),
          canAccessSystemAdmin: Boolean(payload?.data?.capabilities?.canAccessSystemAdmin),
          activeHousehold,
          households
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAccess({ ...emptyAccess(), loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function switchHousehold(householdId: string) {
    if (!householdId || householdId === access.activeHousehold?.id) return;
    const nextHousehold = access.households.find((household) => household.id === householdId) ?? null;
    window.localStorage.setItem("matmakt.activeHouseholdId", householdId);

    // Hvis man staar paa en adminside og bytter til en husholdning der man bare er medlem,
    // send brukeren til dashboard i stedet for aa vise forvirrende auth-/adminfeil.
    if (nextHousehold?.role !== "admin" && activeRequiresHouseholdAdmin(active)) {
      window.location.assign("/dashboard");
      return;
    }

    window.location.reload();
  }

  const visibleSections = useMemo(
    () => navSections
      .map((section) => ({ ...section, items: section.items.filter((item) => canSeeItem(item, access)) }))
      .filter((section) => section.items.length > 0),
    [access]
  );

  const blockedByHouseholdAdmin = !access.loading && activeRequiresHouseholdAdmin(active) && !access.canManageHousehold;
  const blockedBySystemAdmin = !access.loading && activeRequiresSystemAdmin(active) && !access.canAccessSystemAdmin;

  return (
    <main className="min-h-screen bg-[#f6f7f5] p-2 sm:p-4">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] max-w-[1500px] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-soft sm:min-h-[calc(100vh-2rem)] lg:flex-row">
        <aside className="shrink-0 border-b border-line bg-white p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-5">
          <Link href="/prices" className="mb-4 flex items-center gap-3 text-xl font-bold text-brand lg:mb-8">
            <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-emerald-100">
              <img src="/brand/matmakt-mark.svg" alt="" className="h-10 w-10" />
            </span>
            <span>
              <span className="block text-slate-950">Matmakt</span>
              <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Basisvarer</span>
            </span>
          </Link>

          <nav className="space-y-4 lg:space-y-5">
            {visibleSections.map((section) => (
              <div key={section.title}>
                <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</p>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const selected = isActive(item, active);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={cx(
                          "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50",
                          selected && "bg-brand-soft text-brand"
                        )}
                      >
                        <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-white", selected && "bg-white text-brand")}>
                          <Icon size={18} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{item.label}</span>
                          {item.description ? <span className="block truncate text-xs font-normal text-muted">{item.description}</span> : null}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 bg-slate-50/40">
          <header className="flex min-h-20 flex-col gap-3 border-b border-line bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Aktiv husholdning</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {access.households.length > 1 ? (
                  <select
                    value={access.activeHousehold?.id ?? ""}
                    onChange={(event) => switchHousehold(event.target.value)}
                    className="max-w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-emerald-500"
                    aria-label="Bytt husholdning"
                  >
                    {access.households.map((household) => (
                      <option key={household.id} value={household.id}>
                        {household.name} · {roleLabel(household.role)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="truncate text-sm font-black text-slate-900 sm:text-base">
                    {access.activeHousehold?.name ?? (access.loading ? "Laster husholdning..." : "Ingen husholdning")}
                  </p>
                )}
                {access.activeHousehold ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                    {roleLabel(access.activeHousehold.role)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900">{active}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {quickActions.map((action) => (
                <Link key={action.href} href={action.href} className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {action.label}
                </Link>
              ))}
              <AuthStatus />
            </div>
          </header>
          <div className="p-4 sm:p-6 lg:p-8">
            {access.loading ? (
              <section className="rounded-3xl border border-line bg-white p-6 text-sm font-semibold text-slate-500">Sjekker tilgang...</section>
            ) : blockedBySystemAdmin ? (
              <AccessDenied title="Systemadmin kreves" message="Denne delen er bare for systemadmin. Du ser heller ikke systemadmin-menyen uten riktig tilgang." />
            ) : blockedByHouseholdAdmin ? (
              <AccessDenied title="Admin kreves" message="Denne delen er bare for husholdningsadmin. Medlem og barn har samme tilgang foreløpig." />
            ) : (
              children
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function StatCard({ title, value, subtitle, tone = "green" }: { title: string; value: string; subtitle: string; tone?: "green" | "blue" | "amber" | "purple" | "red" }) {
  const tones = { green: "bg-emerald-50 border-emerald-100", blue: "bg-sky-50 border-sky-100", amber: "bg-amber-50 border-amber-100", purple: "bg-violet-50 border-violet-100", red: "bg-rose-50 border-rose-100" };
  return (
    <div className={cx("rounded-2xl border p-4 sm:p-5", tones[tone])}>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-3 break-words text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm leading-5 text-muted">{subtitle}</p>
    </div>
  );
}
