# Middagsforslag

Denne modulen gir enkle middagsforslag basert på eksisterende lager og fryser.

## Ruter

- `GET /api/meals/suggest` - henter forslag basert på `inventory_items` og `products`
- `POST /api/meals/suggest` - samme som GET, praktisk for knapper / refresh
- `/meals` - UI-side for forslag

## Datagrunnlag

Modulen bruker eksisterende tabeller:

- `households`
- `inventory_items`
- `products`

Det opprettes ingen nye tabeller i denne patchen.

## Logikk

Forslagene matches med enkle nøkkelord:

- kjøttdeig + pasta + tomat -> bolognese
- mozzarella + tomat -> pizza
- pasta + ost + rester -> pastaform
- ris + egg -> stekt ris
- fryser/protein -> frysermiddag

Hvert forslag får score, tilgjengelige ingredienser, manglende ingredienser og forslag til hva som bør brukes opp.
