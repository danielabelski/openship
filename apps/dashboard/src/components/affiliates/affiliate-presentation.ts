export const affiliateMoney = (cents: number, locale?: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const affiliateDate = (value: string | null, locale?: string) =>
  value ? new Date(value).toLocaleDateString(locale, { dateStyle: "medium" }) : "—";
/** Parse decimal money without binary rounding or accepting scientific notation. */
export function payoutCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 100 && cents <= 100000000 ? cents : null;
}
