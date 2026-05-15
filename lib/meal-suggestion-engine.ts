import { ensureDefaultHousehold } from "@/lib/db";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export type MealSuggestion = {
  id: string;
  title: string;
  type: "middag" | "lunsj" | "basis" | "restemat";
  timeMinutes: number;
  portions: number;
  score: number;
  confidence: "hoy" | "middels" | "lav";
  availableIngredients: string[];
  missingIngredients: string[];
  useUpIngredients: string[];
  reason: string;
  steps: string[];
  shoppingHint: string;
};

type InventoryRow = {
  id: string;
  product_id: string | null;
  location: string | null;
  quantity: number | string | null;
  desired_quantity: number | string | null;
  expires_at: string | null;
  updated_at: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  is_basis: boolean | null;
  is_freezable: boolean | null;
  image_url: string | null;
};

type PantryItem = {
  productId: string;
  name: string;
  brand: string | null;
  category: string | null;
  quantity: number;
  desiredQuantity: number;
  location: string | null;
  expiresAt: string | null;
  isBasis: boolean;
  isFreezable: boolean;
};

type RecipeRule = {
  id: string;
  title: string;
  type: MealSuggestion["type"];
  timeMinutes: number;
  portions: number;
  required: string[];
  optional: string[];
  useUp: string[];
  steps: string[];
  shoppingHint: string;
};

const recipes: RecipeRule[] = [
  {
    id: "bolognese",
    title: "Bolognese med pasta",
    type: "middag",
    timeMinutes: 35,
    portions: 4,
    required: ["kjottdeig", "pasta", "tomat"],
    optional: ["lok", "gulrot", "stangselleri", "ost", "basilikum"],
    useUp: ["kjottdeig", "tomat", "stangselleri", "gulrot"],
    steps: ["Brun kjøttdeig.", "Fres løk/gulrot/stangselleri hvis dere har.", "Tilsett tomatbase og la koke.", "Server med pasta og ost."],
    shoppingHint: "Kjøp bare ekstra pasta/tomat hvis lageret er lavt."
  },
  {
    id: "pizza-mozzarella",
    title: "Pizza med mozzarella og chorizo/skinke",
    type: "middag",
    timeMinutes: 30,
    portions: 4,
    required: ["mozzarella", "tomat"],
    optional: ["chorizo", "skinke", "ost", "basilikum", "pasta"],
    useUp: ["mozzarella", "chorizo", "skinke", "tomat"],
    steps: ["Lag rask tomatsaus.", "Topp med mozzarella og rester av chorizo/skinke.", "Stek til gyllen.", "Server med enkel salat."],
    shoppingHint: "Bra når mozzarella er kjøpt på tilbud. Mangler bunn kan den legges i handlelisten."
  },
  {
    id: "taco",
    title: "Taco med det dere har",
    type: "middag",
    timeMinutes: 25,
    portions: 4,
    required: ["kjottdeig"],
    optional: ["rømme", "ost", "agurk", "tomat", "paprika", "mais", "lefse"],
    useUp: ["kjottdeig", "rømme", "agurk", "tomat", "ost"],
    steps: ["Stek kjøttdeig med krydder.", "Kutt grønnsaker.", "Bruk rømme/ost hvis dere har.", "Legg manglende tilbehør på handlelisten."],
    shoppingHint: "Ikke kjøp mange ferske tilbehør hvis dere allerede har agurk/tomat som må brukes."
  },
  {
    id: "pastaform",
    title: "Pastaform med ost og rester",
    type: "restemat",
    timeMinutes: 40,
    portions: 4,
    required: ["pasta", "ost"],
    optional: ["skinke", "bacon", "tomat", "rømme", "mozzarella", "kylling"],
    useUp: ["ost", "skinke", "bacon", "rømme", "mozzarella"],
    steps: ["Kok pasta halvveis.", "Bland med ost og rester.", "Tilsett tomat/rømme hvis dere har.", "Gratiner i ovnen."],
    shoppingHint: "God rett for å bruke smårester uten ekstra handling."
  },
  {
    id: "kjottkaker",
    title: "Kjøttkaker med poteter og surkål",
    type: "middag",
    timeMinutes: 35,
    portions: 4,
    required: ["kjøttkaker", "potet"],
    optional: ["surkål", "gulrot", "ertestuing", "saus"],
    useUp: ["kjøttkaker", "potet", "surkål", "gulrot"],
    steps: ["Varm kjøttkaker.", "Kok poteter og grønnsaker.", "Server med surkål eller annet tilbehør.", "Bruk opp åpne glass/pakker først."],
    shoppingHint: "Surkål og poteter er typiske påfyllsvarer hvis de mangler."
  },
  {
    id: "fried-rice",
    title: "Stekt ris med egg og grønnsaker",
    type: "restemat",
    timeMinutes: 20,
    portions: 3,
    required: ["ris", "egg"],
    optional: ["grønnsak", "erter", "gulrot", "skinke", "kylling", "soyasaus"],
    useUp: ["egg", "grønnsak", "skinke", "kylling", "gulrot"],
    steps: ["Bruk kald ris hvis mulig.", "Stek grønnsaker og eventuelle rester.", "Tilsett egg og ris.", "Smak til med soyasaus/krydder."],
    shoppingHint: "Perfekt hvis dere har egg og små grønnsaksrester."
  },
  {
    id: "gryte",
    title: "Tomatgryte med kjøttdeig eller bønner",
    type: "middag",
    timeMinutes: 30,
    portions: 4,
    required: ["tomat"],
    optional: ["kjottdeig", "bønner", "ris", "pasta", "gulrot", "lok", "paprika"],
    useUp: ["tomat", "kjottdeig", "bønner", "paprika", "gulrot"],
    steps: ["Fres grønnsaker.", "Tilsett kjøttdeig/bønner hvis dere har.", "Ha i tomatbase.", "Server med ris eller pasta."],
    shoppingHint: "Billig basisrett når tomatbase og ris/pasta finnes i lageret."
  },
  {
    id: "frysermiddag",
    title: "Frysermiddag med grønt tilbehør",
    type: "middag",
    timeMinutes: 25,
    portions: 2,
    required: ["fryser"],
    optional: ["pizza", "fisk", "kylling", "kjottdeig", "grønnsak", "potet"],
    useUp: ["pizza", "fisk", "kylling", "kjottdeig", "grønnsak"],
    steps: ["Velg eldste protein eller ferdigrett fra fryseren.", "Legg til grønnsaker/poteter fra lager.", "Unngå ny handling hvis dere har nok tilbehør.", "Oppdater lager etterpå."],
    shoppingHint: "Bruk denne før dere kjøper mer kjøtt/frys."
  }
];

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("æ", "a")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesToken(item: PantryItem, token: string) {
  const haystack = normalize(`${item.name} ${item.brand ?? ""} ${item.category ?? ""} ${item.location ?? ""}`);
  const normalizedToken = normalize(token);

  const aliases: Record<string, string[]> = {
    kjottdeig: ["kjottdeig", "kjøttdeig", "storfe", "karbonadedeig", "deig"],
    tomat: ["tomat", "tomater", "hakkede", "san marzano", "passata", "polpa", "pastasaus", "tomatsaus"],
    pasta: ["pasta", "fusilli", "spaghetti", "tagliatelle", "penne", "barilla", "makaroni"],
    lok: ["lok", "løk", "gul løk", "raudløk", "rødløk"],
    gronnsak: ["gronnsak", "grønnsak", "brokkoli", "gulrot", "paprika", "erter", "salat", "agurk", "tomat", "mais", "wok"],
    fryser: ["fryser", "frys", "frossen", "fryst", "pizza", "is", "fisk", "kylling", "kjottdeig", "kjøttdeig"],
    kjottkaker: ["kjottkaker", "kjøttkaker", "fjordland"],
    lefse: ["tortilla", "lefse", "taco", "wrap"],
    potet: ["potet", "poteter"],
    mozzarella: ["mozzarella"],
    ost: ["ost", "jarlsberg", "norvegia", "revet", "cheddar", "parmesan"],
    skinke: ["skinke"],
    chorizo: ["chorizo", "pepperoni", "salami"],
    romme: ["romme", "rømme", "creme fraiche", "lettrømme"],
    egg: ["egg"],
    ris: ["ris", "jasminris", "basmati", "middagsris"],
    kylling: ["kylling", "chicken"],
    fisk: ["fisk", "laks", "torsk", "sei", "ørret", "orret"],
    bonner: ["bonner", "bønner", "kidney", "svarte bonner", "svarte bønner"],
    paprika: ["paprika"],
    gulrot: ["gulrot", "gulrøtter"],
    bacon: ["bacon"],
    mais: ["mais"]
  };

  const terms = aliases[normalizedToken] ?? [normalizedToken];
  return terms.some((term) => haystack.includes(normalize(term)));
}

function findMatches(items: PantryItem[], tokens: string[]) {
  const names: string[] = [];
  for (const token of tokens) {
    const match = items.find((item) => item.quantity > 0 && matchesToken(item, token));
    if (match) names.push(match.name);
  }
  return [...new Set(names)];
}

function missingTokens(items: PantryItem[], tokens: string[]) {
  return tokens.filter((token) => !items.some((item) => item.quantity > 0 && matchesToken(item, token)));
}

function expiringSoon(item: PantryItem) {
  if (!item.expiresAt) return false;
  const expires = new Date(item.expiresAt).getTime();
  const inSevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return Number.isFinite(expires) && expires <= inSevenDays;
}

function confidenceFromScore(score: number): MealSuggestion["confidence"] {
  if (score >= 80) return "hoy";
  if (score >= 55) return "middels";
  return "lav";
}

function createFallbackSuggestions(pantryItems: PantryItem[]): MealSuggestion[] {
  const availableItems = pantryItems
    .filter((item) => item.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);

  if (!availableItems.length) return [];

  const useUpItems = availableItems.filter((item) => expiringSoon(item) || item.quantity > Math.max(1, item.desiredQuantity));
  const basisItems = availableItems.filter((item) => item.isBasis);
  const mainItems = availableItems.slice(0, 6).map((item) => item.name);
  const fallbackSuggestions: MealSuggestion[] = [];

  fallbackSuggestions.push({
    id: "lager-middag",
    title: "Middag med varer fra lageret",
    type: "middag",
    timeMinutes: 25,
    portions: 4,
    score: 55,
    confidence: "middels",
    availableIngredients: mainItems,
    missingIngredients: ["Velg saus eller tilbehør etter behov"],
    useUpIngredients: useUpItems.slice(0, 4).map((item) => item.name),
    reason: "Det finnes lagerlinjer, men ingen ferdig oppskrift traff nøkkelordene godt nok. Bruk dette som en generell middagsplan basert på varene dere har.",
    steps: [
      "Velg 2–4 varer fra lageret som passer sammen.",
      "Start med varer som har høy mengde eller nærmer seg utløpsdato.",
      "Legg bare manglende tilbehør i handlelisten.",
      "Oppdater lageret etter middag."
    ],
    shoppingHint: "Sjekk handlelisten for saus, grønnsaker eller tilbehør som mangler."
  });

  if (useUpItems.length) {
    fallbackSuggestions.push({
      id: "bruk-opp-lager",
      title: "Bruk-opp-middag fra lageret",
      type: "restemat",
      timeMinutes: 20,
      portions: 3,
      score: 60,
      confidence: "middels",
      availableIngredients: useUpItems.slice(0, 6).map((item) => item.name),
      missingIngredients: [],
      useUpIngredients: useUpItems.slice(0, 6).map((item) => item.name),
      reason: "Noen lagerlinjer bør prioriteres fordi de enten er over ønsket nivå eller nærmer seg utløpsdato.",
      steps: [
        "Finn varene som bør brukes først.",
        "Lag en enkel restemiddag, omelett, pasta, gryte eller toast ut fra det dere har.",
        "Suppler med basisvarer fra skapet.",
        "Unngå ny handling hvis retten kan fullføres med lageret."
      ],
      shoppingHint: "Denne retten bør normalt ikke kreve ekstra handling."
    });
  }

  if (basisItems.length) {
    fallbackSuggestions.push({
      id: "basis-middag",
      title: "Basisrett fra basisutvalg",
      type: "basis",
      timeMinutes: 30,
      portions: 4,
      score: 50,
      confidence: "lav",
      availableIngredients: basisItems.slice(0, 6).map((item) => item.name),
      missingIngredients: ["Velg protein, karbohydrat eller grønnsak som passer"],
      useUpIngredients: useUpItems.slice(0, 3).map((item) => item.name),
      reason: "Basisutvalget har varer på lager som kan brukes til en enkel hverdagsrett.",
      steps: [
        "Velg én basisvare som hovedingrediens.",
        "Kombiner med rester eller varer med høy beholdning.",
        "Legg manglende nøkkelvare i handlelisten hvis nødvendig.",
        "Lagre erfaringen som ny regel senere hvis retten fungerer godt."
      ],
      shoppingHint: "Bruk prissammenligning på basisvarer hvis noe må fylles på."
    });
  }

  return fallbackSuggestions;
}

export async function suggestMeals() {
  const supabase = getSupabaseAdmin();
  const household = await ensureDefaultHousehold();

  const inventoryResult = await supabase
    .from("inventory_items")
    .select("id, product_id, location, quantity, desired_quantity, expires_at, updated_at")
    .eq("household_id", household.id)
    .order("updated_at", { ascending: false });

  if (inventoryResult.error) throw inventoryResult.error;

  const inventoryRows = (inventoryResult.data ?? []) as InventoryRow[];
  const productIds = [...new Set(inventoryRows.map((row) => row.product_id).filter(Boolean))] as string[];

  const productsResult = productIds.length
    ? await supabase
        .from("products")
        .select("id, name, brand, category, is_basis, is_freezable, image_url")
        .in("id", productIds)
    : { data: [], error: null };

  if (productsResult.error) throw productsResult.error;

  const productById = new Map((productsResult.data ?? []).map((product) => [product.id, product as ProductRow]));

  const pantryItems: PantryItem[] = inventoryRows
    .map((row) => {
      const product = row.product_id ? productById.get(row.product_id) : null;
      if (!product) return null;
      return {
        productId: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        quantity: toNumber(row.quantity),
        desiredQuantity: toNumber(row.desired_quantity),
        location: row.location,
        expiresAt: row.expires_at,
        isBasis: Boolean(product.is_basis),
        isFreezable: Boolean(product.is_freezable)
      };
    })
    .filter((item): item is PantryItem => Boolean(item));

  const recipeSuggestions = recipes
    .map((recipe): MealSuggestion => {
      const requiredAvailable = findMatches(pantryItems, recipe.required);
      const optionalAvailable = findMatches(pantryItems, recipe.optional);
      const missingRequired = missingTokens(pantryItems, recipe.required);
      const missingOptional = missingTokens(pantryItems, recipe.optional).slice(0, 4);
      const useUpIngredients = findMatches(pantryItems.filter((item) => item.quantity > 0 && (expiringSoon(item) || item.quantity > Math.max(1, item.desiredQuantity))), recipe.useUp);

      const requiredScore = recipe.required.length ? (requiredAvailable.length / recipe.required.length) * 65 : 0;
      const optionalScore = Math.min(20, optionalAvailable.length * 4);
      const useUpScore = Math.min(15, useUpIngredients.length * 5);
      const score = Math.round(requiredScore + optionalScore + useUpScore);

      const missingIngredients = [...missingRequired, ...missingOptional].slice(0, 6);
      const availableIngredients = [...new Set([...requiredAvailable, ...optionalAvailable])].slice(0, 8);

      const reason = missingRequired.length === 0
        ? `${recipe.title} passer godt med det dere har på lager${useUpIngredients.length ? ", og hjelper med å bruke opp varer" : ""}.`
        : `${recipe.title} mangler ${missingRequired.length} nøkkelingrediens${missingRequired.length === 1 ? "" : "er"}, men kan fortsatt planlegges.`;

      return {
        id: recipe.id,
        title: recipe.title,
        type: recipe.type,
        timeMinutes: recipe.timeMinutes,
        portions: recipe.portions,
        score,
        confidence: confidenceFromScore(score),
        availableIngredients,
        missingIngredients,
        useUpIngredients,
        reason,
        steps: recipe.steps,
        shoppingHint: recipe.shoppingHint
      };
    })
    .filter((suggestion) => suggestion.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const suggestions = recipeSuggestions.length ? recipeSuggestions : createFallbackSuggestions(pantryItems);

  const stats = {
    inventoryItems: pantryItems.length,
    highConfidence: suggestions.filter((suggestion) => suggestion.confidence === "hoy").length,
    useUpMeals: suggestions.filter((suggestion) => suggestion.useUpIngredients.length > 0).length,
    noExtraShopping: suggestions.filter((suggestion) => suggestion.missingIngredients.length === 0).length
  };

  return { household, stats, suggestions };
}
