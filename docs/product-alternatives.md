# Produktalternativer og billigmerker

Denne modulen foreslår rimeligere alternativer til produkter husholdningen allerede kjøper.

## Flyt

1. Gå til `/alternatives`.
2. Trykk `Finn alternativer`.
3. Appen leser lagrede produkter og bruker enkle regler for varegrupper som surkål, tomater, pasta, ketchup, kjøttdeig, papir og poser.
4. Kandidater søkes opp i Kassalapp og lagres i `product_alternatives`.
5. Marker alternativer som `Testes`, `Godkjent` eller `Avvist`.

## Viktig

Modulen garanterer ikke at produkter er identiske. Den finner funksjonelt like eller rimeligere alternativer. Bruk status `Testes` for smakstest eller funksjonstest før dere bytter fast.

## Database

Kjør `supabase/patch-007-product-alternatives.sql` i Supabase SQL Editor.
