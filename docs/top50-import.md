# Importjobb: topp 50 husholdningsvarer

Denne importjobben seeder de 50 viktigste produktene identifisert fra kvitteringene.

Se listen:

```bash
curl -s http://localhost:3000/api/import/top-products | python3 -m json.tool
```

Test uten å lagre:

```bash
curl -s -X POST http://localhost:3000/api/import/top-products \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"limit":5}' | python3 -m json.tool
```

Importer alle:

```bash
curl -s -X POST http://localhost:3000/api/import/top-products \
  -H "Content-Type: application/json" \
  -d '{"dryRun":false}' | python3 -m json.tool
```

Hvis `CRON_SECRET` er satt:

```bash
curl -s -X POST http://localhost:3000/api/import/top-products \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: DIN_SECRET" \
  -d '{"dryRun":false}' | python3 -m json.tool
```
