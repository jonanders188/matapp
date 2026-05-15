# Recommendations Engine v1

Denne patchen legger til en enkel anbefalingsmotor for Husholdningspilot.

## Nye filer

- `lib/recommendation-engine.ts`
- `app/recommendations/page.tsx`
- `app/api/recommendations/generate/route.ts`
- `app/api/products/sync-prices/route.ts`
- `supabase/patch-004-recommendations-engine.sql`

## Bruk

1. Gå til `/products`.
2. Klikk `Importer topp 50`.
3. Klikk `Synk alle priser`.
4. Gå til `/recommendations`.
5. Klikk `Generer anbefalinger`.

## Logikk

Motoren bruker:

- siste/laveste prisobservasjon
- målpris
- lagerstatus
- ønsket lager
- om varen er basisvare
- om varen kan fryses

Handlinger:

- `buy` = kjøp nå
- `stock_up` = hamstre
- `wait` = vent
- `use_up` = bruk opp
- `switch_brand` = reservert for senere
