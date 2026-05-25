import Link from "next/link";

export default function BetaPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f5] p-5 text-slate-950">
      <section className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <img src="/brand/matmakt-logo.svg" alt="Matmakt" className="h-14 w-auto" />
        <p className="mt-8 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Lukket beta</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">Matmakt åpner snart</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Vi tester Matmakt med utvalgte husholdninger før offentlig lansering. Du kan bruke appen anonymt, og e-post er eneste krav for innlogging.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Kontoer som brukes til spam, misbruk eller falske data kan stenges uten varsel.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white">Logg inn</Link>
          <Link href="/" className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-800">Til forsiden</Link>
        </div>
      </section>
    </main>
  );
}
