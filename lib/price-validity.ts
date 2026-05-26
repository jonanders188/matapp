export type PriceType = "regular" | "campaign" | "member_price" | "multi_buy" | "clearance" | "unknown";
export type PriceConfidence = "high" | "medium" | "low" | "unknown";

export const CURRENT_PRICE_GREEN_DAYS = 30;
export const CURRENT_PRICE_YELLOW_DAYS = 45;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PriceValidityInput = {
  observed_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  price_type?: PriceType | string | null;
  is_campaign?: boolean | null;
  exclude_from_analysis?: boolean | null;
};

export function priceAgeDays(value: string | null | undefined, now = new Date()) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / MS_PER_DAY));
}

export function priceFreshness(value: string | null | undefined, now = new Date()): "fresh" | "check" | "stale" | "unknown" {
  const ageDays = priceAgeDays(value, now);
  if (ageDays === null) return "unknown";
  if (ageDays <= CURRENT_PRICE_GREEN_DAYS) return "fresh";
  if (ageDays <= CURRENT_PRICE_YELLOW_DAYS) return "check";
  return "stale";
}

export function isWithinValidPeriod(price: PriceValidityInput, now = new Date()) {
  if (price.exclude_from_analysis === true) return false;

  const from = price.valid_from ? Date.parse(price.valid_from) : null;
  const until = price.valid_until ? Date.parse(price.valid_until) : null;
  const nowTime = now.getTime();

  if (from !== null && Number.isFinite(from) && from > nowTime) return false;
  if (until !== null && Number.isFinite(until) && until < nowTime) return false;

  return true;
}

export function isCampaignPrice(price: PriceValidityInput) {
  return price.is_campaign === true || price.price_type === "campaign";
}

export function isUsableCurrentPrice(price: PriceValidityInput, options?: { includeCampaigns?: boolean; now?: Date }) {
  const now = options?.now ?? new Date();
  if (!isWithinValidPeriod(price, now)) return false;

  const campaign = isCampaignPrice(price);
  if (campaign && options?.includeCampaigns === false) return false;

  // Campaign prices with a future valid_until are current while the campaign is active,
  // even if observed_at is older than the normal freshness window.
  if (campaign && price.valid_until && Date.parse(price.valid_until) >= now.getTime()) return true;

  return priceFreshness(price.observed_at, now) !== "stale" && priceFreshness(price.observed_at, now) !== "unknown";
}

export function defaultPriceValidityColumns(observedAt: string | null | undefined, overrides?: Partial<PriceValidityInput>) {
  const observed = observedAt ?? new Date().toISOString();
  const priceType = overrides?.price_type ?? "regular";
  return {
    valid_from: overrides?.valid_from ?? observed,
    valid_until: overrides?.valid_until ?? null,
    price_type: priceType,
    is_campaign: overrides?.is_campaign ?? priceType === "campaign",
    campaign_label: null,
    confidence: "high" as PriceConfidence,
    exclude_from_analysis: overrides?.exclude_from_analysis ?? false
  };
}
