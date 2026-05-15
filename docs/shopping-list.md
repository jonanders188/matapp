# Smart handleliste

Denne modulen lager en handleliste fra aktive anbefalinger.

Flyt:

1. Importer produkter på `/products`.
2. Synk priser.
3. Generer anbefalinger på `/recommendations`.
4. Gå til `/shopping-list` og generer handleliste.

Handlelisten begrenser antall butikker. Varer som bare gir små enkeltstopp utenfor de beste butikkene merkes som `skipped` og vises under "Ikke verdt egen tur".

API:

- `GET /api/shopping-list/current`
- `POST /api/shopping-list/generate` med `{ "maxStores": 2 }`

SQL:

Kjør `supabase/patch-005-shopping-list.sql` i Supabase SQL Editor.
