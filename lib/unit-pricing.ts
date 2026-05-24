export type UnitPricingProduct = {
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  package_size?: string | null;
  net_content_value?: number | string | null;
  net_content_unit?: string | null;
  comparison_unit?: string | null;
};

export type UnitPricingResult = {
  unit_price: number | null;
  comparison_unit: string | null;
  package_quantity: number | null;
  package_unit: string | null;
  unit_price_source: "kassalapp" | "computed" | "manual" | "unknown";
  reason: string;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeUnit(value: string) {
  const unit = value.trim().toLowerCase();
  if (["kg", "kilo", "kilogram"].includes(unit)) return "kg";
  if (["g", "gram"].includes(unit)) return "g";
  if (["l", "liter", "litre", "ltr"].includes(unit)) return "l";
  if (["dl"].includes(unit)) return "dl";
  if (["cl"].includes(unit)) return "cl";
  if (["ml"].includes(unit)) return "ml";
  if (["stk", "st", "pk", "pakke", "pakker", "pakk", "rl", "rull", "ruller", "egg", "bleie", "bleier", "tablett", "tabletter", "tabs", "vask"].includes(unit)) return "stk";
  return unit;
}

function amountInComparisonUnit(amount: number, unit: string) {
  const normalized = normalizeUnit(unit);
  if (normalized === "kg") return { quantity: amount, unit: "kg" };
  if (normalized === "g") return { quantity: amount / 1000, unit: "kg" };
  if (normalized === "l") return { quantity: amount, unit: "l" };
  if (normalized === "dl") return { quantity: amount / 10, unit: "l" };
  if (normalized === "cl") return { quantity: amount / 100, unit: "l" };
  if (normalized === "ml") return { quantity: amount / 1000, unit: "l" };
  if (normalized === "stk") return { quantity: amount, unit: "stk" };
  return null;
}

function decimalPatternToNumber(value: string) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9,.]+/g, " ")
    .replace(/,/g, ".")
    .trim();
}

function explicitProductNetContent(product: UnitPricingProduct) {
  const value = toNumber(product.net_content_value);
  const unit = typeof product.net_content_unit === "string" ? product.net_content_unit : null;
  if (!value || value <= 0 || !unit) return null;
  const converted = amountInComparisonUnit(value, unit);
  if (!converted || converted.quantity <= 0) return null;

  return {
    package_quantity: value,
    package_unit: normalizeUnit(unit),
    comparison_quantity: converted.quantity,
    comparison_unit: converted.unit
  };
}

function inferProductNetContentFromText(value: unknown) {
  const text = normalizeSearchText(value);
  if (!text) return null;

  const compact = text.replace(/\s+/g, "");

  // Multipacks must win over single package size:
  // "6pk 1.5l", "6 x 1,5l", "10x0,33l" should compare on total liters.
  const multipackPatterns: RegExp[] = [
    /(\d+)\s*(?:pk|pakk|pakke|pakker)\s*(?:a|à|x)?\s*(\d+(?:\.\d+)?)\s*(kg|kilo|kilogram|g|gram|liter|litre|ltr|l|dl|cl|ml)\b/,
    /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|kilo|kilogram|g|gram|liter|litre|ltr|l|dl|cl|ml)\b/,
    /(\d+(?:\.\d+)?)\s*(kg|kilo|kilogram|g|gram|liter|litre|ltr|l|dl|cl|ml)\s*(?:flaske|boks|stk)?\s*(\d+)\s*(?:pk|pakk|pakke|pakker)\b/
  ];

  for (let index = 0; index < multipackPatterns.length; index += 1) {
    const match = text.match(multipackPatterns[index]) ?? compact.match(multipackPatterns[index]);
    if (!match) continue;

    let count: number | null = null;
    let amount: number | null = null;
    let unit: string | null = null;

    if (index === 2) {
      amount = decimalPatternToNumber(match[1]);
      unit = normalizeUnit(match[2]);
      count = decimalPatternToNumber(match[3]);
    } else {
      count = decimalPatternToNumber(match[1]);
      amount = decimalPatternToNumber(match[2]);
      unit = normalizeUnit(match[3]);
    }

    if (!count || count <= 1 || !amount || amount <= 0 || !unit) continue;

    const converted = amountInComparisonUnit(amount * count, unit);
    if (converted && converted.quantity > 0) {
      return {
        package_quantity: amount * count,
        package_unit: unit,
        comparison_quantity: converted.quantity,
        comparison_unit: converted.unit,
        source: "parsed-package" as const
      };
    }
  }

  const weightOrVolumeMatch =
    compact.match(/(\d+(?:\.\d+)?)(kg|kilo|kilogram|g|gram|liter|litre|l|dl|cl|ml)\b/) ??
    text.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilogram|g|gram|liter|litre|l|dl|cl|ml)\b/);

  if (weightOrVolumeMatch) {
    const amount = toNumber(weightOrVolumeMatch[1]);
    const unit = normalizeUnit(weightOrVolumeMatch[2]);
    if (amount && amount > 0) {
      const converted = amountInComparisonUnit(amount, unit);
      if (converted && converted.quantity > 0) {
        return {
          package_quantity: amount,
          package_unit: unit,
          comparison_quantity: converted.quantity,
          comparison_unit: converted.unit,
          source: "parsed-package" as const
        };
      }
    }
  }

  // Do not use compact text for count-based units. It can turn
  // "Str.7 16stk" into "716stk" and produce wildly wrong unit prices.
  const packCountMatch = text.match(
    /(?:^|\s)(\d+)\s*(stk|pk|pakk|pakke|pakker|rl|rull|ruller|egg|bleie|bleier|tablett|tabletter|tabs|vask)\b/
  );

  if (packCountMatch) {
    const amount = toNumber(packCountMatch[1]);
    if (amount && amount > 0) {
      return {
        package_quantity: amount,
        package_unit: "stk",
        comparison_quantity: amount,
        comparison_unit: "stk",
        source: "parsed-package" as const
      };
    }
  }

  return null;
}

export function inferProductNetContent(product: UnitPricingProduct) {
  const explicit = explicitProductNetContent(product);
  if (explicit) return { ...explicit, source: "product-fields" as const };

  // Product-level package_size is more trusted than free-text product names.
  // This prevents simple EAN packages such as "1500 ml" from being
  // reinterpreted as multipacks because a name/OCR/import context contains
  // misleading "x4" or "x6" text.
  const packageSizeOnly = inferProductNetContentFromText(product.package_size);
  if (packageSizeOnly) return packageSizeOnly;

  const nameOnly = inferProductNetContentFromText(product.name);
  if (nameOnly) return nameOnly;

  return null;
}

export function unitLabel(unit: string | null | undefined) {
  if (unit === "kg") return "kr/kg";
  if (unit === "l") return "kr/l";
  if (unit === "stk") return "kr/stk";
  return null;
}

export function computeComparableUnitPrice(product: UnitPricingProduct, packagePrice: unknown, fallbackUnitPrice?: unknown): UnitPricingResult {
  const price = toNumber(packagePrice);
  const fallback = toNumber(fallbackUnitPrice);

  const inferred = inferProductNetContent(product);
  const preferredComparisonUnit = typeof product.comparison_unit === "string" && product.comparison_unit.trim()
    ? product.comparison_unit.trim().toLowerCase()
    : inferred?.comparison_unit ?? null;

  if (fallback && fallback > 0) {
    return {
      unit_price: roundPrice(fallback),
      comparison_unit: preferredComparisonUnit ?? inferred?.comparison_unit ?? null,
      package_quantity: inferred?.package_quantity ?? null,
      package_unit: inferred?.package_unit ?? null,
      unit_price_source: "kassalapp",
      reason: "Brukte enhetspris fra priskilde."
    };
  }

  if (!price || price <= 0) {
    return {
      unit_price: null,
      comparison_unit: preferredComparisonUnit,
      package_quantity: inferred?.package_quantity ?? null,
      package_unit: inferred?.package_unit ?? null,
      unit_price_source: "unknown",
      reason: "Mangler gyldig pakkepris."
    };
  }

  if (!inferred || inferred.comparison_quantity <= 0) {
    return {
      unit_price: null,
      comparison_unit: preferredComparisonUnit,
      package_quantity: null,
      package_unit: null,
      unit_price_source: "unknown",
      reason: "Fant ikke trygg pakningsstørrelse."
    };
  }

  return {
    unit_price: roundPrice(price / inferred.comparison_quantity),
    comparison_unit: preferredComparisonUnit ?? inferred.comparison_unit,
    package_quantity: inferred.package_quantity,
    package_unit: inferred.package_unit,
    unit_price_source: inferred.source === "product-fields" ? "manual" : "computed",
    reason: `Beregnet fra pakkepris og ${inferred.package_quantity} ${inferred.package_unit}.`
  };
}

export function unitPricingColumnsForProduct(product: UnitPricingProduct, packagePrice: unknown, fallbackUnitPrice?: unknown) {
  const pricing = computeComparableUnitPrice(product, packagePrice, fallbackUnitPrice);
  return {
    unit_price: pricing.unit_price,
    comparison_unit: pricing.comparison_unit,
    package_quantity: pricing.package_quantity,
    package_unit: pricing.package_unit,
    unit_price_source: pricing.unit_price_source,
    raw_unit_pricing: {
      comparison_unit: pricing.comparison_unit,
      package_quantity: pricing.package_quantity,
      package_unit: pricing.package_unit,
      unit_price_source: pricing.unit_price_source,
      unit_price_reason: pricing.reason,
      unit_price_label: unitLabel(pricing.comparison_unit)
    }
  };
}
