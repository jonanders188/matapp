import Link from "next/link";
import {
  Box,
  Database,
  PackageSearch,
  Settings,
  ShieldCheck,
  Smartphone,
  Tags
} from "lucide-react";
import { cx } from "@/lib/utils";
import { AuthStatus } from "@/components/auth-status";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  aliases?: string[];
  description?: string;
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: "Daglig bruk",
    items: [
      { label: "Lager", href: "/inventory", icon: Box, aliases: ["Inventory"], description: "Beholdning hjemme" },
      { label: "Prisoversikt", href: "/prices", icon: Tags, aliases: ["Priser", "Prissammenligning"], description: "Nåpris på basisvarer" },
      { label: "Skann kvittering", href: "/mobile2", icon: Smartphone, aliases: ["Kvittering", "Mobile2", "Mobil lager"], description: "Del mange priser på én gang" },
      { label: "Skann produkt", href: "/mobile", icon: Smartphone, aliases: ["Mobile", "Mobil butikk"], description: "Del én pris raskt" }
    ]
  },
  {
    title: "Varer",
    items: [
      { label: "Basisvarer", href: "/products", icon: PackageSearch, aliases: ["Basisutvalg", "Produkter"], description: "Ditt faste vareutvalg" },
      { label: "Legg til varer", href: "/catalog", icon: Database, aliases: ["Produktregister", "Katalog"], description: "Finn flere varer" }
    ]
  },
  {
    title: "Oppsett",
    items: [
      { label: "Admin", href: "/admin", icon: Settings, aliases: ["Innstillinger", "Oppsett", "Integrasjoner"], description: "Husholdning og butikker" },
      { label: "Systemadmin", href: "/admin/product-groups", icon: ShieldCheck, aliases: ["Produktgrupper", "System Admin"], description: "Globale produktgrupper" }
    ]
  }
];

const quickActions = [
  { label: "Skann produkt", href: "/mobile" },
  { label: "Skann kvittering", href: "/mobile2" },
  { label: "Mine basisvarer", href: "/products" }
] as const;

function isActive(item: NavItem, active: string) {
  return item.label === active || item.aliases?.includes(active);
}

export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
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
            {navSections.map((section) => (
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
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Damgata 21D</p>
              <p className="text-lg font-bold text-slate-900">{active}</p>
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
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
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
