import Link from "next/link";

const steps = [
  ["1", "Bygg basisvarene", "Skann det du allerede har i kjøleskap, fryser, skuffer og skap."],
  ["2", "Skann kvittering", "Finn priser automatisk når du har handlet."],
  ["3", "Se beste kjøp nå", "Bruk felles prisdata når du handler — enten du deler priser selv eller ikke."]
] as const;

const principles = [
  "Start med varene dere faktisk har hjemme.",
  "Du kan bruke Matmakt uten å dele priser.",
  "Deling er frivillig — og gjør fellesskapet bedre.",
  "Appen viser nåsituasjonen, ikke gammel historikk."
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f7f5] text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/brand/matmakt-logo.svg" alt="Matmakt" className="h-12 w-auto" />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50">Logg inn</Link>
            <Link href="/mobile2" className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800">Skann kvittering</Link>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-emerald-50 px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-700 ring-1 ring-emerald-100">Felles prisdata for husholdninger</p>
            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">Skann hjemmevarene. Bygg basisvarer.</h1>
            <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">
              Den raskeste starten er å skanne varene du allerede har hjemme. De legges på lager og blir basisvarer uten at du trenger pris.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Du får verdi uten å bidra med priser. Kvitteringer kan skannes senere og matches mot basisvarene dine.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-sm hover:bg-emerald-800">Start enkelt</Link>
              <Link href="/mobile2" className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-base font-black text-slate-900 shadow-sm hover:bg-slate-50">Skann hjemmevarer</Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="rounded-[1.5rem] bg-slate-950 p-6 text-white">
              <img src="/brand/matmakt-logo.svg" alt="Matmakt" className="h-16 w-auto rounded-xl bg-white/95 p-2" />
              <h2 className="mt-8 text-3xl font-black">Start med lageret ditt.</h2>
              <p className="mt-3 text-slate-300">Skann varer i kjøleskap, fryser, skuffer og skap. En basisvare er basisvare helt til du velger den bort.</p>
            </div>
            <div className="mt-5 grid gap-3">
              {steps.map(([number, title, text]) => (
                <div key={number} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-sm font-black text-white">{number}</span>
                    <div>
                      <h3 className="font-black">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="grid gap-3 pb-8 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((principle) => (
            <div key={principle} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-700 shadow-sm">{principle}</div>
          ))}
        </section>
      </section>
    </main>
  );
}
