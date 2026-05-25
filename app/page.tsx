import Link from "next/link";

const steps = [
  ["1", "Skann produkt", "Finn riktig vare med strekkode. Matmakt fokuserer på varene husholdningen faktisk bruker."],
  ["2", "Skann kvittering", "Del faktiske butikkpriser uten å skrive inn alt manuelt."],
  ["3", "Få bedre valg", "Se beste kjøp nå på basisvarene dine, basert på delte prisdata fra fellesskapet."]
] as const;

const principles = [
  "Basisvarer først — ikke tusen tilfeldige produkter.",
  "Faktiske priser fra produkter og kvitteringer.",
  "Pris, helse, livsstil og husholdningens behov kan veie ulikt.",
  "Historikk ligger i databasen, men appen viser nåsituasjonen."
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f7f5] text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/brand/matmakt-mark.svg" alt="" className="h-12 w-12" />
            <span className="text-2xl font-black tracking-tight">Matmakt</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50">Logg inn</Link>
            <Link href="/mobile" className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800">Skann pris</Link>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-emerald-50 px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-700 ring-1 ring-emerald-100">Felles prisdata for husholdninger</p>
            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">Ta kontroll på basisvarene.</h1>
            <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">
              Matmakt er et forbrukerdrevet prisnettverk. Skann produkter og kvitteringer, del faktiske butikkpriser og få bedre valg tilbake på varene som betyr noe for din husholdning.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Dagligvaremarkedet styres av få aktører med mye data. Matmakt gir husholdningene et felles datagrunnlag — ikke for å følge alt, men for å forstå nåprisen på egne basisvarer.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-sm hover:bg-emerald-800">Start med dine basisvarer</Link>
              <Link href="/mobile" className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-base font-black text-slate-900 shadow-sm hover:bg-slate-50">Skann produkt</Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="rounded-[1.5rem] bg-slate-950 p-6 text-white">
              <img src="/brand/matmakt-logo.svg" alt="Matmakt" className="h-16 w-auto rounded-xl bg-white p-2" />
              <h2 className="mt-8 text-3xl font-black">Del pris. Bygg oversikt. Handle smartere.</h2>
              <p className="mt-3 text-slate-300">Hver skannede pris styrker både din husholdning og fellesskapet.</p>
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
