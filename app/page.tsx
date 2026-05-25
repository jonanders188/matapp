import Link from "next/link";

const steps = [
  ["1", "Skann produkt", "Del én butikkpris på noen sekunder."],
  ["2", "Skann kvittering", "Del mange priser på én gang når du har handlet."],
  ["3", "Se beste kjøp nå", "Matmakt viser aktuelle priser på basisvarene som betyr noe for deg."]
] as const;

const principles = [
  "Bare basisvarene dere faktisk følger.",
  "Produkt- og kvitteringsskanning er nok.",
  "Felles prisdata gir bedre valg tilbake.",
  "Appen viser nåsituasjonen — ikke gammel historikk."
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
            <Link href="/mobile2" className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800">Skann kvittering</Link>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-emerald-50 px-4 py-2 text-sm font-black uppercase tracking-[0.18em] text-emerald-700 ring-1 ring-emerald-100">Felles prisdata for husholdninger</p>
            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">Del priser. Få bedre valg.</h1>
            <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">
              Matmakt gjør prisdeling enkelt: skann et produkt eller en kvittering, så bidrar du til felles prisdata for basisvarer.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Du trenger ikke registrere alt. Velg varene husholdningen bryr seg om, og bruk fellesskapet til å se beste kjøp nå.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="rounded-2xl bg-emerald-700 px-6 py-4 text-base font-black text-white shadow-sm hover:bg-emerald-800">Start enkelt</Link>
              <Link href="/mobile2" className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-base font-black text-slate-900 shadow-sm hover:bg-slate-50">Skann kvittering</Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="rounded-[1.5rem] bg-slate-950 p-6 text-white">
              <img src="/brand/matmakt-logo.svg" alt="Matmakt" className="h-16 w-auto rounded-xl bg-white p-2" />
              <h2 className="mt-8 text-3xl font-black">To ting er nok: produkt eller kvittering.</h2>
              <p className="mt-3 text-slate-300">Matmakt gjør resten: knytter prisen til riktig vare, butikk og basisvare.</p>
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
