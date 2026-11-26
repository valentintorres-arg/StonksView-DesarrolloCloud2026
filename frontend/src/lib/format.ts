// Formato para mostrar. Los montos llegan como string decimal exacto; acá se
// convierten a number solo para presentarlos (la precisión de cálculo ya la
// garantizó el backend).

const SOURCE_TYPES: Record<string, string> = {
  exchange: "Exchange",
  wallet: "Wallet",
  broker: "Broker",
  other: "Otra",
};

const ASSET_CLASSES: Record<string, string> = {
  crypto: "Cripto",
  stock: "Acciones",
  etf: "ETF",
  forex: "Divisas",
  cedear: "CEDEAR",
  other: "Otros",
};

export function money(value: string, currency: string): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

// Con signo explícito, para ganancias y pérdidas.
export function signedMoney(value: string, currency: string): string {
  const n = Number(value);
  const formatted = money(String(Math.abs(n)), currency);
  return n > 0 ? `+${formatted}` : n < 0 ? `−${formatted}` : formatted;
}

export function percent(value: string | null, signed = false): string {
  if (value === null) return "—";
  const n = Number(value);
  const text = `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(Math.abs(n))} %`;
  if (!signed) return text;
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : text;
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export const sourceTypeLabel = (type: string) => SOURCE_TYPES[type] ?? type;
export const assetClassLabel = (assetClass: string) => ASSET_CLASSES[assetClass] ?? assetClass;

// Opciones de los selectores, en el orden en que se muestran. Los valores son
// los que admite el CHECK de la base.
export const SOURCE_TYPE_OPTIONS = Object.entries(SOURCE_TYPES).map(([value, label]) => ({ value, label }));
export const ASSET_CLASS_OPTIONS = ["crypto", "stock", "etf", "cedear", "forex", "other"].map((value) => ({
  value,
  label: ASSET_CLASSES[value]!,
}));
