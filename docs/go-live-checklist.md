# Go-live sjekkliste for Husholdningspilot

Denne sjekklisten er for å få MVP-en stabilt opp å kjøre lokalt og på Vercel.

## 1. Lokalt

```bash
npm install
npm run build
npm run dev
```

Åpne:

```text
http://localhost:3000/setup
```

Kjør full oppstart:

1. Sjekk miljø og database
2. Importer topp 50 produkter
3. Synk alle priser
4. Generer anbefalinger
5. Generer handleliste

## 2. Supabase

Kjør alle SQL-patcher i rekkefølge. De viktigste tabellene er:

- households
- products
- inventory_items
- price_observations
- recommendations
- shopping_lists
- shopping_list_items

Sjekk status via:

```text
/api/bootstrap/status
```

## 3. Vercel environment variables

Sett disse i Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
KASSALAPP_API_KEY=...
DEFAULT_HOUSEHOLD_NAME=Familien
CRON_SECRET=...
```

Ikke legg `.env.local` i Git.

## 4. Test etter deploy

- `/api/health`
- `/api/bootstrap/status`
- `/setup`
- `/products`
- `/recommendations`
- `/shopping-list`
- `/inventory`

## 5. Første praktiske bruk

Start med å gjøre disse manuelt hver gang du tester en ny deploy:

1. Importer topp 50
2. Synk alle priser
3. Juster lager
4. Generer anbefalinger
5. Generer handleliste

Når dette er stabilt, kan vi automatisere mer.
