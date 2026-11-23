export function overlaps(buyerMax: number, sellerMin: number) {
  return buyerMax >= sellerMin;
}

export function midpoint(buyerMax: number, sellerMin: number) {
  return Math.floor((buyerMax + sellerMin) / 2);
}

export function formatUnits(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
