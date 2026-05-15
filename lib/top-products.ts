export type TopProductSeed = {
  key: string;
  search: string;
  ean?: string;
  category: string;
  targetPrice?: number;
  desiredStock: number;
  location: "Kjokken" | "Kjoleskap" | "Fryser" | "Vaskerom" | "Bad";
  isBasis?: boolean;
  isFreezable?: boolean;
  preferredStore?: string;
  notes?: string;
};

// Basert paa kvitteringene/handlemønsteret vi har identifisert i samtalen.
// EAN brukes der vi kjenner den; ellers brukes presis søketekst mot Kassalapp.
export const TOP_50_PRODUCTS: TopProductSeed[] = [
  { key: "coca-cola-zero-6pk", search: "Coca-Cola Zero 1,5l 6pk", category: "Drikke", targetPrice: 89, desiredStock: 2, location: "Kjokken", preferredStore: "KIWI", notes: "Kjøp ekstra bare under målpris." },
  { key: "kjottdeig-gilde-400", search: "Gilde kjøttdeig uten salt vann 400g", ean: "7037203627317", category: "Protein", targetPrice: 79.9, desiredStock: 4, location: "Fryser", isBasis: true, isFreezable: true, preferredStore: "Laveste" },
  { key: "agurk-hel-norsk", search: "Agurk hel norsk", category: "Frukt og grønt", targetPrice: 24, desiredStock: 2, location: "Kjoleskap", preferredStore: "KIWI", notes: "KIWI Pluss gir ekstra verdi." },
  { key: "q-lettmelk-175", search: "Q Lettmelk 0,5% 1,75l", ean: "7048840081950", category: "Meieri", targetPrice: 30, desiredStock: 3, location: "Kjoleskap", isBasis: true, preferredStore: "Laveste" },
  { key: "tine-lettmelk-laktosefri-1l", search: "Tine Lettmelk 0,5% laktosefri 1l", category: "Meieri", targetPrice: 27.5, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "eldorado-hakkede-tomater-urter", search: "Eldorado hakkede tomater med urter 390g", ean: "7311041049235", category: "Italiensk", targetPrice: 14.9, desiredStock: 8, location: "Kjokken", isBasis: true },
  { key: "strianese-san-marzano", search: "Tomater San Marzano 400g Strianese", ean: "8003716001158", category: "Italiensk", targetPrice: 30, desiredStock: 6, location: "Kjokken", isBasis: true, preferredStore: "MENY/KIWI" },
  { key: "omo-ultra-hvitt-1kg", search: "OMO Ultra Hvitt pulver 1kg", ean: "7046110321331", category: "Hygiene", targetPrice: 50, desiredStock: 2, location: "Vaskerom", isBasis: true },
  { key: "softlan-outdoor-fresh-1l", search: "Softlan tøymykner outdoor fresh 1l", ean: "8718951190702", category: "Hygiene", targetPrice: 39.9, desiredStock: 2, location: "Vaskerom", isBasis: true },
  { key: "libero-upgo-str6", search: "Libero Up&Go str 6 18stk", ean: "7322541090238", category: "Barn og hygiene", targetPrice: 50, desiredStock: 3, location: "Bad", isBasis: true },
  { key: "batis-multipack", search: "Båtis multipack 5stk Hennig-Olsen", ean: "7041012750005", category: "Frys", targetPrice: 74, desiredStock: 1, location: "Fryser", isFreezable: true },
  { key: "kroneis-jordbar", search: "Krone-is jordbær 6stk Hennig-Olsen", category: "Frys", targetPrice: 60, desiredStock: 1, location: "Fryser", isFreezable: true },
  { key: "granarolo-mozzarella-220", search: "Granarolo Mozzarella 220g", ean: "8002670004205", category: "Italiensk", targetPrice: 32, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "tine-revet-ost-370", search: "Tine revet ost økonomipakke 370g", category: "Meieri", targetPrice: 64, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "norzola-150", search: "Norzola ost 150g Tine", category: "Meieri", targetPrice: 40, desiredStock: 1, location: "Kjoleskap" },
  { key: "gilde-kokt-skinke", search: "Kokt skinke ekte 200g Gilde", category: "Pålegg", targetPrice: 47, desiredStock: 1, location: "Kjoleskap", isBasis: true },
  { key: "gilde-bacon-ternet-200", search: "Bacon ternet 200g Gilde", category: "Protein", targetPrice: 45, desiredStock: 2, location: "Fryser", isFreezable: true },
  { key: "grilstad-hot-chorizo", search: "Grilstad hot chorizo 100g", category: "Italiensk", targetPrice: 38, desiredStock: 2, location: "Kjoleskap" },
  { key: "sommerkotelett-gilde", search: "Sommerkotelett Gilde", category: "Protein", targetPrice: 130, desiredStock: 2, location: "Fryser", isFreezable: true },
  { key: "potet-sma-gule-900", search: "Potet små gule 900g", category: "Frukt og grønt", targetPrice: 28, desiredStock: 2, location: "Kjokken", isBasis: true },
  { key: "gulrot-750", search: "Gulrot 750g beger", category: "Frukt og grønt", targetPrice: 33, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "lok-gul-450", search: "Løk gul 2stk 450g strømpe", category: "Frukt og grønt", targetPrice: 18, desiredStock: 3, location: "Kjokken", isBasis: true },
  { key: "stangselleri-350", search: "Stangselleri 350g", category: "Frukt og grønt", targetPrice: 28, desiredStock: 1, location: "Kjoleskap" },
  { key: "tomater-kg", search: "Tomater kg", category: "Frukt og grønt", targetPrice: 50, desiredStock: 1, location: "Kjoleskap" },
  { key: "sommerkal", search: "Sommerkål nykål", category: "Frukt og grønt", targetPrice: 35, desiredStock: 1, location: "Kjoleskap" },
  { key: "paprika-red", search: "Paprika red", category: "Frukt og grønt", targetPrice: 14, desiredStock: 2, location: "Kjoleskap" },
  { key: "bananer", search: "Bananer Bama", category: "Frukt og grønt", targetPrice: 25, desiredStock: 1, location: "Kjokken" },
  { key: "jordbar", search: "Jordbær 500g", category: "Frukt og grønt", targetPrice: 30, desiredStock: 1, location: "Kjoleskap" },
  { key: "hindu-basilikum", search: "Hindu basilikum 14g", ean: "7045010003019", category: "Krydder", targetPrice: 30, desiredStock: 1, location: "Kjokken", isBasis: true },
  { key: "hindu-laurbarblad", search: "Hindu laurbærblad 8g", category: "Krydder", targetPrice: 19, desiredStock: 1, location: "Kjokken", isBasis: true },
  { key: "barilla-tagliatelle-500", search: "Barilla Tagliatelle 500g", ean: "8076809580731", category: "Italiensk", targetPrice: 43, desiredStock: 3, location: "Kjokken", isBasis: true },
  { key: "barilla-fusilli-500", search: "Barilla Fusilli 500g", ean: "8076802085981", category: "Italiensk", targetPrice: 38, desiredStock: 3, location: "Kjokken", isBasis: true },
  { key: "barilla-fusilli-glutenfri", search: "Barilla Fusilli glutenfri 400g", category: "Italiensk", targetPrice: 38.5, desiredStock: 1, location: "Kjokken" },
  { key: "big-one-pepperoni", search: "Big One pepperoni 590g", category: "Frys", targetPrice: 75, desiredStock: 1, location: "Fryser", isFreezable: true },
  { key: "bjorke-rommedressing", search: "Rømmedressing med hvitløk 480ml Bjerke", category: "Tilbehør", targetPrice: 39, desiredStock: 1, location: "Kjoleskap" },
  { key: "lettrømme-laktosefri", search: "Lettrømme 17% laktosefri 300g", category: "Meieri", targetPrice: 25, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "idun-ketchup-usukker", search: "Tomatketchup u/sukker 510g Idun", ean: "7039010181341", category: "Tilbehør", targetPrice: 20, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "nora-surkal-450", search: "Nora surkål 450g", ean: "7041310130905", category: "Tilbehør", targetPrice: 24, desiredStock: 1, location: "Kjokken" },
  { key: "nora-agurker-skivede", search: "Agurker skivede 580g Nora", category: "Tilbehør", targetPrice: 30, desiredStock: 1, location: "Kjoleskap" },
  { key: "mills-kaviar-245", search: "Kaviar 245g Mills", ean: "7036110009940", category: "Pålegg", targetPrice: 40, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "philadelphia-original-200", search: "Philadelphia original 200g", category: "Pålegg", targetPrice: 36, desiredStock: 1, location: "Kjoleskap" },
  { key: "egg-12pk", search: "Egg frittgående 12pk", category: "Meieri", targetPrice: 30, desiredStock: 2, location: "Kjoleskap", isBasis: true },
  { key: "brodposer-unik", search: "Brødposer 6l 65stk Unik", category: "Husholdning", targetPrice: 19, desiredStock: 1, location: "Kjokken", isBasis: true },
  { key: "torky-torkerull", search: "Torky tørkerull 2rl", category: "Husholdning", targetPrice: 35, desiredStock: 2, location: "Kjokken", isBasis: true },
  { key: "toalettpapir-soft", search: "Toalettpapir soft 8rl Unik", category: "Husholdning", targetPrice: 37, desiredStock: 2, location: "Bad", isBasis: true },
  { key: "vatsservietter-unik", search: "Våtservietter plastfri 24stk Unik", category: "Barn og hygiene", targetPrice: 23, desiredStock: 2, location: "Bad", isBasis: true },
  { key: "avfallsposer-unik", search: "Avfallsposer drastring 40l 15stk Unik", category: "Husholdning", targetPrice: 30, desiredStock: 2, location: "Kjokken", isBasis: true },
  { key: "jif-baderom-spray", search: "Jif baderom spray 500ml", category: "Hygiene", targetPrice: 42, desiredStock: 1, location: "Vaskerom", isBasis: true },
  { key: "jif-klorin-rengjoringsspray", search: "Jif klorin rengjøringsspray 500ml", category: "Hygiene", targetPrice: 43, desiredStock: 1, location: "Vaskerom" },
  { key: "heineken-000", search: "Heineken 0,0% 0,33l 6pk", category: "Drikke", targetPrice: 76, desiredStock: 1, location: "Kjokken" }
];
