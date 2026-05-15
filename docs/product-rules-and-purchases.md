# Produktregler og enkle kjøp

Denne patchen legger til to trygge funksjoner som bygger videre på eksisterende produkt-, lager- og prisdata.

## Produktregler

Ny side: `/products/[id]`

Brukes til å justere:

- målpris
- målpris-type, per pakke eller per enhetspris
- ønsket lager
- basisvare
- kan fryses
- foretrukket butikk
- kategori og notater

Dette påvirker anbefalinger og handleliste.

## Enkle kjøp

Ny side: `/purchases`

Brukes til å registrere kjøp manuelt før full kvitteringsimport finnes.

Når en varelinje kobles til et produkt, økes lageret automatisk for produktet.

## SQL

Kjør `supabase/patch-006-product-rules-purchases.sql` i Supabase SQL Editor.
