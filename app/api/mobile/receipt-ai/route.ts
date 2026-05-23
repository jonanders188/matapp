import { NextResponse } from "next/server";
import { requireCurrentHousehold } from "@/lib/current-household";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StoreOption = {
  storeKey: string;
  storeName: string;
  isEnabled: boolean;
  priority: number;
};

type ReceiptAiItem = {
  name: string;
  quantity: number;
  unit: "stk";
  quantitySourceText: string | null;
  lineTotal: number;
  lineTotalSourceText: string | null;
  unitPrice: number;
  confidence: number;
  warning: string | null;
};

type ReceiptAiResponse = {
  storeKey: string | null;
  storeName: string | null;
  receiptDate: string | null;
  items: ReceiptAiItem[];
  warnings: string[];
};

function asNumber(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStoreText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9_]/g, "");
}

function looksLikeNonProduct(name: string) {
  return /(mva|trumf|bonus|bonusgrunnlag|sum|total|kjopesum|kjøpesum|betaling|bankaxept|visa|mastercard|kontant|avrunding|kvittering|terminal|butikk|org\.?nr|takk)/i.test(name);
}

function normalizeAiItem(value: unknown): ReceiptAiItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;

  const name = cleanText(item.name)
    .replace(/^[`'‘’"“”]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (name.length < 3) return null;
  if (looksLikeNonProduct(name)) return null;

  const lineTotal = roundMoney(asNumber(item.lineTotal, 0));
  if (!Number.isFinite(lineTotal) || lineTotal <= 0 || lineTotal > 100000) return null;

  const rawQuantity = asNumber(item.quantity, NaN);
  const quantitySourceText = cleanText(item.quantitySourceText) || null;
  const lineTotalSourceText = cleanText(item.lineTotalSourceText) || null;

  const quantityIsValid = Number.isFinite(rawQuantity) && rawQuantity >= 1 && rawQuantity <= 99;
  const quantity = quantityIsValid ? Math.max(1, Math.floor(rawQuantity)) : 1;

  const unitPrice = roundMoney(lineTotal / quantity);
  const aiUnitPrice = roundMoney(asNumber(item.unitPrice, unitPrice));

  const warnings: string[] = [];
  const aiWarning = typeof item.warning === "string" && item.warning.trim() ? item.warning.trim() : "";

  if (!quantitySourceText) {
    warnings.push("AI fant ikke tydelig antallslinje. Kontroller antall.");
  }

  if (Math.abs(aiUnitPrice - unitPrice) > 0.02) {
    warnings.push(`AI unitPrice (${aiUnitPrice}) avvek fra lineTotal/quantity (${unitPrice}); appen brukte beregnet pris.`);
  }

  if (aiWarning) warnings.push(aiWarning);

  return {
    name,
    quantity,
    unit: "stk",
    quantitySourceText,
    lineTotal,
    lineTotalSourceText,
    unitPrice,
    confidence: Math.max(0, Math.min(1, asNumber(item.confidence, warnings.length ? 0.6 : 0.9))),
    warning: warnings.length ? warnings.join(" ") : null
  };
}

function parseOpenAiOutput(payload: unknown): string {
  const root = payload as Record<string, unknown>;

  if (typeof root.output_text === "string") return root.output_text;

  const output = Array.isArray(root.output) ? root.output : [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") continue;
    const content = Array.isArray((entry as Record<string, unknown>).content)
      ? ((entry as Record<string, unknown>).content as unknown[])
      : [];

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.output_text === "string") return record.output_text;
    }
  }

  throw new Error("AI svarte uten lesbar JSON.");
}

async function loadRegisteredStores(householdId: string): Promise<StoreOption[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("household_store_preferences")
    .select("store_key, store_name, is_enabled, priority")
    .eq("household_id", householdId)
    .order("priority", { ascending: true })
    .order("store_name", { ascending: true });

  if (error) throw error;

  const storesByKey = new Map<string, StoreOption>();
  for (const store of data ?? []) {
    const storeKey = String(store.store_key ?? "").trim().toLowerCase();
    const storeName = String(store.store_name ?? "").trim();
    if (!storeKey || !storeName) continue;

    const next = {
      storeKey,
      storeName,
      isEnabled: Boolean(store.is_enabled),
      priority: Number(store.priority ?? 100)
    };

    const existing = storesByKey.get(storeKey);
    if (!existing || next.priority < existing.priority || (next.isEnabled && !existing.isEnabled)) {
      storesByKey.set(storeKey, next);
    }
  }

  return [...storesByKey.values()];
}

function matchRegisteredStore(rawStoreKey: unknown, rawStoreName: unknown, stores: StoreOption[]) {
  const key = normalizeStoreText(rawStoreKey);
  const name = normalizeStoreText(rawStoreName);

  if (key) {
    const direct = stores.find((store) => normalizeStoreText(store.storeKey) === key);
    if (direct) return direct;
  }

  if (name) {
    const byName = stores.find((store) => {
      const storeKey = normalizeStoreText(store.storeKey);
      const storeName = normalizeStoreText(store.storeName);
      return storeName === name || storeKey === name || name.includes(storeName) || storeName.includes(name) || name.includes(storeKey);
    });
    if (byName) return byName;
  }

  return null;
}

const RECEIPT_AI_SYSTEM_PROMPT = 'Du er kvitteringsparser for norske dagligvarekvitteringer. Les bildet visuelt, ikke bare OCR-tekst. Returner strukturert JSON etter schemaet.\n\nVIKTIGSTE REGLER:\n- Returner ALLE produktlinjer fra topp til bunn. Ikke stopp tidlig.\n- Ignorer summer, MVA, Trumf/bonus, rabattlinjer, betaling, kort, kontant, terminal, org.nr, kvitteringsfooter.\n- Velg butikk bare blant allowedStores. Returner nøyaktig storeKey fra allowedStores hvis kvitteringen matcher en registrert butikk.\n- Hvis butikken ikke matcher allowedStores: storeKey=null og legg warning. Ikke finn på ny butikk.\n- Produktlinjen har vanligvis total linjepris til høyre.\n- Kjøpt antall står ofte på linjen rett under produktet: "1 stk", "1stk", "2 stk", "6 stk".\n- Les alltid 1-2 linjer under produktlinjen før du bestemmer quantity.\n- quantitySourceText skal være den eksakte teksten der antallet ble funnet.\n- lineTotalSourceText skal være den eksakte pristeksten der total linjepris ble funnet.\n- unitPrice = lineTotal / quantity.\n- Ikke bruk pakkestørrelse som kjøpt antall. "18g", "420g", "1kg", "5stk multipack", "12stk", "6pk", "20pk", "2rl" er del av produktnavn/pakning, ikke kjøpt antall.\n\nEKSEMPLER:\n\nEksempel A:\nProduktlinje: "Tomatbønner 420g nora                         89,40 kr"\nLinje under:  "6 stk"\nRiktig JSON item:\n{\n  "name": "Tomatbønner 420g nora",\n  "quantity": 6,\n  "unit": "stk",\n  "quantitySourceText": "6 stk",\n  "lineTotal": 89.40,\n  "lineTotalSourceText": "89,40 kr",\n  "unitPrice": 14.90,\n  "confidence": 0.96,\n  "warning": null\n}\n\nEksempel B:\nProduktlinje: "Ultra hvitt pulver 1kg omo                   105,80 kr"\nLinje under:  "2 stk"\nRiktig JSON item:\n{\n  "name": "Ultra hvitt pulver 1kg omo",\n  "quantity": 2,\n  "unit": "stk",\n  "quantitySourceText": "2 stk",\n  "lineTotal": 105.80,\n  "lineTotalSourceText": "105,80 kr",\n  "unitPrice": 52.90,\n  "confidence": 0.96,\n  "warning": null\n}\n\nEksempel C:\nProduktlinje: "Krone-is jordbær 6stk hennig-olsen            46,90 kr"\nLinje under:  "1 stk"\nRiktig JSON item:\n{\n  "name": "Krone-is jordbær 6stk hennig-olsen",\n  "quantity": 1,\n  "unit": "stk",\n  "quantitySourceText": "1 stk",\n  "lineTotal": 46.90,\n  "lineTotalSourceText": "46,90 kr",\n  "unitPrice": 46.90,\n  "confidence": 0.95,\n  "warning": null\n}\nMerk: "6stk" i navnet er pakkestørrelse, ikke kjøpt antall.\n\nEksempel D:\nProduktlinje: "Champignon skivet 184g first price             19,80 kr"\nLinje under:  "2stk"\nRiktig JSON item:\n{\n  "name": "Champignon skivet 184g first price",\n  "quantity": 2,\n  "unit": "stk",\n  "quantitySourceText": "2stk",\n  "lineTotal": 19.80,\n  "lineTotalSourceText": "19,80 kr",\n  "unitPrice": 9.90,\n  "confidence": 0.95,\n  "warning": null\n}\n\nEksempel E:\nProduktlinje: "Toalettpapir 20pk hvit lambi                  109,00 kr"\nLinje under:  "1 stk"\nRiktig JSON item:\n{\n  "name": "Toalettpapir 20pk hvit lambi",\n  "quantity": 1,\n  "unit": "stk",\n  "quantitySourceText": "1 stk",\n  "lineTotal": 109.00,\n  "lineTotalSourceText": "109,00 kr",\n  "unitPrice": 109.00,\n  "confidence": 0.95,\n  "warning": null\n}\nMerk: "20pk" i navnet er pakkestørrelse.\n\nEksempel F:\nProduktlinje: "Tomater kg                                    24,07 kr"\nLinje under:  "482 g"\nRiktig JSON item for denne appen nå:\n{\n  "name": "Tomater kg",\n  "quantity": 1,\n  "unit": "stk",\n  "quantitySourceText": null,\n  "lineTotal": 24.07,\n  "lineTotalSourceText": "24,07 kr",\n  "unitPrice": 24.07,\n  "confidence": 0.60,\n  "warning": "Vektvare. Appen støtter foreløpig bare stk; kontroller manuelt."\n}\n\nNAVNEKVALITET:\n- Ikke oversett eller kreativt forbedre produktnavn.\n- Behold merkevaren så godt du kan: BAMA, First Price, TINE, Gilde, Mills, Nora, Prior, Freia, Hennig-Olsen.\n- Rett åpenbare OCR-feil når kvitteringen tydelig viser kjent merke: "frist price" -> "first price", "barna" -> "bama" bare hvis bildet faktisk tilsier det.\n- Hvis usikker på bokstaver i navn, behold beste lesning, men tall/antall/pris er viktigst.\n\nKOMPLETTHET:\n- Hvis kvitteringen er lang, fortsett til bunnen.\n- Hvis du mistenker at linjer mangler, legg warning i warnings.\n';

const RECEIPT_AI_USER_PROMPT = 'Les kvitteringen. allowedStores=${JSON.stringify(allowedStores)}. Returner ALLE produktlinjer. AI skal være fasit for butikk, antall og enhetspris. Bruk ICL-eksemplene: spesielt antallslinjen rett under varen. Returner kun JSON etter schemaet.';

export async function POST(request: Request) {
  try {
    const { householdId } = await requireCurrentHousehold(request);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY mangler." }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as { imageBase64?: string; storeName?: string; storeKey?: string } | null;
    const imageBase64 = String(body?.imageBase64 ?? "");

    if (!imageBase64.startsWith("data:image/")) {
      return NextResponse.json({ error: "Mangler gyldig kvitteringsbilde." }, { status: 400 });
    }

    const stores = await loadRegisteredStores(householdId);
    if (!stores.length) {
      return NextResponse.json({ error: "Ingen butikker er registrert i systemet." }, { status: 409 });
    }

    const allowedStores = stores.map((store) => ({
      storeKey: store.storeKey,
      storeName: store.storeName,
      isEnabled: store.isEnabled
    }));

    const model = process.env.OPENAI_RECEIPT_MODEL || "gpt-4.1-mini";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 16000,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: RECEIPT_AI_SYSTEM_PROMPT
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: RECEIPT_AI_USER_PROMPT
              },
              { type: "input_image", image_url: imageBase64, detail: "high" }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_items_ai_direct",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                storeKey: { type: ["string", "null"] },
                storeName: { type: ["string", "null"] },
                receiptDate: { type: ["string", "null"] },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string" },
                      quantity: { type: "number" },
                      unit: { type: "string", enum: ["stk"] },
                      quantitySourceText: { type: ["string", "null"] },
                      lineTotal: { type: "number" },
                      lineTotalSourceText: { type: ["string", "null"] },
                      unitPrice: { type: "number" },
                      confidence: { type: "number" },
                      warning: { type: ["string", "null"] }
                    },
                    required: [
                      "name",
                      "quantity",
                      "unit",
                      "quantitySourceText",
                      "lineTotal",
                      "lineTotalSourceText",
                      "unitPrice",
                      "confidence",
                      "warning"
                    ]
                  }
                },
                warnings: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["storeKey", "storeName", "receiptDate", "items", "warnings"]
            }
          }
        }
      })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "AI-kvitteringslesing feilet.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const jsonText = parseOpenAiOutput(payload);
    const parsed = JSON.parse(jsonText) as ReceiptAiResponse;
    const matchedStore = matchRegisteredStore(parsed.storeKey, parsed.storeName, stores);
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map(normalizeAiItem)
      .filter((item): item is ReceiptAiItem => item !== null);

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning) => typeof warning === "string" && warning.trim()).map((warning) => warning.trim())
      : [];

    if (!matchedStore) {
      warnings.push("AI fant butikk på kvitteringen, men den matchet ingen registrert butikk. Velg butikk manuelt.");
    }

    const uncertainCount = items.filter((item) => item.warning).length;
    if (uncertainCount > 0) {
      warnings.push(`${uncertainCount} varelinjer må kontrolleres.`);
    }

    return NextResponse.json({
      data: {
        storeKey: matchedStore?.storeKey ?? null,
        storeName: matchedStore?.storeName ?? parsed.storeName ?? null,
        receiptDate: parsed.receiptDate ?? null,
        items,
        warnings
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI-kvitteringslesing feilet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
