export type ProductForAlternativeRules = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
};

export type AlternativeRule = {
  query: string;
  reason: string;
  matchType: string;
  confidence: number;
  preferredBrands?: string[];
};

function includesAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

export function alternativeRulesForProduct(product: ProductForAlternativeRules): AlternativeRule[] {
  const text = `${product.name} ${product.brand ?? ""} ${product.category ?? ""}`.toLowerCase();
  const rules: AlternativeRule[] = [];

  if (includesAny(text, ["surkål", "surkal", "rødkål", "rodkal"])) {
    rules.push({ query: "First Price surkål 450g", reason: "Surkål er en enkel tilbehørsvare med høy byttbarhet.", matchType: "first_price", confidence: 0.82, preferredBrands: ["First Price", "Eldorado", "REMA 1000"] });
  }

  if (includesAny(text, ["tomater", "hakkede tomater", "san marzano", "passata", "polpa"])) {
    rules.push({ query: "First Price hakkede tomater 400g", reason: "Billig tomatbase fungerer ofte godt i gryter, lasagne og kjøttsaus.", matchType: "first_price", confidence: 0.74, preferredBrands: ["First Price", "Eldorado", "REMA 1000"] });
    rules.push({ query: "Eldorado hakkede tomater 400g", reason: "Eldorado er ofte et godt hverdagsalternativ til premiumtomater.", matchType: "private_label", confidence: 0.72, preferredBrands: ["Eldorado", "First Price"] });
  }

  if (includesAny(text, ["barilla", "pasta", "fusilli", "spaghetti", "tagliatelle", "penne", "rigatoni"])) {
    rules.push({ query: "Eldorado pasta 500g", reason: "Billigere pasta er ofte god nok i hverdagsretter med saus.", matchType: "private_label", confidence: 0.68, preferredBrands: ["Eldorado", "First Price", "REMA 1000"] });
    rules.push({ query: "First Price pasta 500g", reason: "First Price kan være et rimelig hverdagsalternativ til merkevarepasta.", matchType: "first_price", confidence: 0.63, preferredBrands: ["First Price"] });
  }

  if (includesAny(text, ["ketchup", "tomatketchup"])) {
    rules.push({ query: "First Price ketchup", reason: "Ketchup er en god kandidat for smakstest mot billigmerke.", matchType: "first_price", confidence: 0.58, preferredBrands: ["First Price", "Eldorado"] });
  }

  if (includesAny(text, ["agurker skivede", "sylteagurk", "agurk skivet"])) {
    rules.push({ query: "First Price sylteagurk", reason: "Sylteagurk/skivede agurker har ofte høy byttbarhet.", matchType: "first_price", confidence: 0.62, preferredBrands: ["First Price", "Eldorado"] });
  }

  if (includesAny(text, ["kjøttdeig", "kjottdeig", "karbonadedeig"])) {
    rules.push({ query: "First Price kjøttdeig 400g", reason: "Sammenlign fettprosent og salt/vann. Kan være godt bytte i taco, lasagne og bolognese.", matchType: "first_price", confidence: 0.66, preferredBrands: ["First Price", "Folkets", "Nordfjord", "REMA 1000"] });
  }

  if (includesAny(text, ["revet ost", "gulost", "norvegia", "mozzarella"])) {
    rules.push({ query: "Eldorado ost", reason: "Billigere ost kan være godt nok i matlaging, men bør smakstestes.", matchType: "private_label", confidence: 0.52, preferredBrands: ["Eldorado", "First Price"] });
  }

  if (includesAny(text, ["tørkerull", "torky", "toalettpapir", "brødposer", "avfallsposer", "fryseposer"])) {
    rules.push({ query: `First Price ${product.name}`.slice(0, 80), reason: "Papir og poser er funksjonsvarer der billigmerke ofte er nok.", matchType: "first_price", confidence: 0.7, preferredBrands: ["First Price", "Eldorado"] });
  }

  return rules;
}

export function productIsAlreadyPrivateLabel(product: ProductForAlternativeRules) {
  const brand = (product.brand ?? "").toLowerCase();
  const name = product.name.toLowerCase();
  return includesAny(`${brand} ${name}`, ["first price", "eldorado", "rema 1000", "x-tra", "coop"]);
}
