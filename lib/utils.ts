export function kr(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
}

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function unitPriceLabel(value: number | null | undefined, comparisonUnit?: string | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";

  const suffix = comparisonUnit === "kg"
    ? "kg"
    : comparisonUnit === "l"
      ? "l"
      : comparisonUnit === "stk"
        ? "stk"
        : "enhet";

  return `${kr(value)}/${suffix}`;
}
