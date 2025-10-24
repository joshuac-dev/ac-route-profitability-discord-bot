export function parseMoney(str) {
  // "$16,957" => 16957; "$177 * 380" => 177
  if (!str) return 0;
  const m = String(str).match(/\$?([0-9,]+(\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1].replace(/,/g, ''))) : 0;
}
export function formatUSD(n) {
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(Math.round(n));
}
