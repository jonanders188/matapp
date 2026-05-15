export const stores = ["KIWI", "MENY", "Oda", "REMA"] as const;

export const products = [
  { id: "omo", name: "OMO Ultra Hvitt", sub: "pulver 1 kg", category: "Hygiene", target: 50, stock: "Lavt lager", image: "🧺" },
  { id: "libero", name: "Libero Up&Go", sub: "str. 6, 18 stk", category: "Hygiene", target: 50, stock: "På lager", image: "🍼" },
  { id: "kjottdeig", name: "Kjøttdeig", sub: "400 g", category: "Protein", target: 80, stock: "Lavt lager", image: "🥩" },
  { id: "cola", name: "Coca-Cola Zero", sub: "1,5L x 6", category: "Drikke", target: 259, stock: "På lager", image: "🥤" },
  { id: "melk", name: "Q Lettmelk", sub: "1,75 l", category: "Meieri", target: 30, stock: "På lager", image: "🥛" },
  { id: "san", name: "San Marzano", sub: "tomater 400 g", category: "Italiensk", target: 30, stock: "På lager", image: "🍅" },
  { id: "pasta", name: "Barilla Fusilli", sub: "500 g", category: "Italiensk", target: 35, stock: "På lager", image: "🍝" },
  { id: "softlan", name: "Softlan", sub: "1 l", category: "Hygiene", target: 40, stock: "Snart tom", image: "🧴" },
  { id: "tomat", name: "Hakkede tomater", sub: "400 g", category: "Basis", target: 15, stock: "På lager", image: "🥫" },
  { id: "agurk", name: "Agurk hel norsk", sub: "1 stk", category: "Frukt og grønt", target: 24, stock: "På lager", image: "🥒" }
];

export const priceRows = products.map((p, i) => {
  const kiwi = [49.0, 79.9, 81.9, 267, 29.9, 27.9, 34.4, 39.9, 14.9, 27.9][i];
  const meny = [69.9, 79.9, 84.9, 269, 32.3, 41.9, 39.9, 47.9, 16.9, 29.9][i];
  const oda = [49.0, 84.9, 79.9, 279, 31.5, 22.9, 38.5, 42.9, 15.9, 28.9][i];
  const rema = [55.9, 87.9, 83.9, 273, 30.9, 19.9, 28.9, 43.5, 15.9, 28.9][i];
  const prices = { KIWI: kiwi, MENY: meny, Oda: oda, REMA: rema };
  const entries = Object.entries(prices).sort((a, b) => a[1] - b[1]);
  return { ...p, prices, lowestStore: entries[0][0], lowestPrice: entries[0][1], lastBought: ["7. mai", "5. mai", "4. mai", "4. mai", "7. mai", "3. mai", "2. mai", "6. mai", "3. mai", "5. mai"][i] };
});

export const recommendations = [
  "Kjøp frukt og grønt på KIWI når 15 % Trumf gjør effektiv pris lavest.",
  "Vent med OMO hvis lageret er nok og pris er over 50 kr per kg.",
  "Kjøp kjøttdeig når den er under målpris og porsjoner til fryser.",
  "Bruk tomater og pasta fra basislager før nye middagsvarer kjøpes."
];
