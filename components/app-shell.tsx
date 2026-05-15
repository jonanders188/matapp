import Link from "next/link";
import {
  Box,
  Home,
  ListChecks,
  PackageSearch,
  ReceiptText,
  Settings,
  Smartphone,
  Tags,
  Utensils
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
      { label: "Oversikt", href: "/dashboard", icon: Home, description: "Hva bør gjøres nå" },
      { label: "Handleliste", href: "/shopping-list", icon: ListChecks, aliases: ["Handleplan"], description: "Neste handletur" },
      { label: "Middager", href: "/meals", icon: Utensils, description: "Forslag fra lager" },
      { label: "Priser", href: "/prices", icon: Tags, aliases: ["Prissammenligning"], description: "Billigste butikk" }
    ]
  },
  {
    title: "Varer",
    items: [
      { label: "Produkter", href: "/products", icon: PackageSearch, description: "Basisutvalg" },
      { label: "Lager", href: "/inventory", icon: Box, description: "Hva dere har" },
      { label: "Skann vare", href: "/mobile", icon: Smartphone, aliases: ["Mobil lager"], description: "Inn og ut av lager" },
      { label: "Kjøp", href: "/purchases", icon: ReceiptText, description: "Historikk" }
    ]
  },
  {
    title: "Oppsett",
    items: [
      { label: "Admin", href: "/admin", icon: Settings, aliases: ["Innstillinger", "Oppsett", "Integrasjoner"], description: "Husholdning og butikker" }
    ]
  }
];

const quickActions = [
  { label: "Skann", href: "/mobile" },
  { label: "Handleliste", href: "/shopping-list" },
  { label: "Legg til vare", href: "/products" }
] as const;

function isActive(item: NavItem, active: string) {
  return item.label === active || item.aliases?.includes(active);
}

export function AppShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f6f7f5] p-3 sm:p-4">
      <div className="mx-auto flex max-w-[1500px] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-soft lg:flex-row">
        <aside className="shrink-0 border-b border-line bg-white p-4 lg:w-64 lg:border-b-0 lg:border-r lg:p-5">
          <Link href="/dashboard" className="mb-5 flex items-center gap-3 text-xl font-bold text-brand lg:mb-8">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-soft">🛒</span>
            <span>Husholdning</span>
          </Link>

          <nav className="space-y-5">
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
                          "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50",
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
  return <div className={cx("rounded-2xl border p-5", tones[tone])}><p className="text-sm font-medium text-slate-700">{title}</p><p className="mt-3 text-3xl font-bold">{value}</p><p className="mt-2 text-sm text-muted">{subtitle}</p></div>;
}
