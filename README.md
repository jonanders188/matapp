# Matmakt

Felles prisdata for smartere husholdninger. Bygg basisvarer fra det du faktisk har hjemme, skann kvitteringer når du vil, og bruk felles nåpriser uten at bidrag er et krav.

Matmakt er et forbrukerdrevet prisnettverk for basisvarer. Husholdninger kan bygge sitt eget varegrunnlag, dra nytte av crowd sharing, og frivillig dele faktiske butikkpriser når det passer.

## Inneholder

- Next.js App Router
- Tailwind UI basert på mockupene
- Pris-dashboard
- Lager og fryser
- Handleplan
- Integrasjoner
- API-route mot Kassalapp via server-side env var
- Supabase SQL schema

## Kom i gang lokalt

```bash
npm install
cp .env.example .env.local
npm run dev
```

Legg inn:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
KASSALAPP_API_KEY=...
```

Ikke legg Kassalapp-nøkkelen i klientkode, GitHub eller Google Sheets-celler. Bruk miljøvariabler i Vercel.

## Supabase

1. Opprett et Supabase-prosjekt.
2. Åpne SQL editor.
3. Kjør `supabase/schema.sql`.
4. Legg RLS-policyer før produksjonsbruk. MVP-schemaet aktiverer RLS, men inkluderer ikke ferdige bruker-policyer.

## Vercel

1. Push repo til GitHub.
2. Importer i Vercel.
3. Legg inn env vars under Project Settings -> Environment Variables.
4. Deploy.

## Neste arbeid

- Import av Trumf-/Oda-kvitteringer
- EAN-matching mot Kassalapp
- Daglig cron for priser
- Faktiske anbefalingsregler basert på lager + målpris + forbruk
- Auth med Supabase
- RLS policies per household


## Patch: aktivert MVP med Kassalapp + Supabase

Denne patchen legger til:

- `/products` for sok og lagring av produkter
- `/api/kassalapp/search?q=...` for server-side Kassalapp-sok
- `/api/products` for lagring og lesing av produkter i Supabase
- `/api/health` for enkel konfigurasjonssjekk
- `/api/cron/sync-prices` for daglig prissynk
- `vercel.json` med cron-oppsett
- `.env.example` med nodvendige variabler

### Miljovariabler

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
KASSALAPP_API_KEY=...
DEFAULT_HOUSEHOLD_NAME=Familien
CRON_SECRET=...
```

### Test lokalt

```bash
npm install
cp .env.example .env.local
npm run dev
```

Gaa til `http://localhost:3000/products`, sok etter for eksempel `San Marzano` eller `OMO Ultra Hvitt`, og trykk `Legg til`.
