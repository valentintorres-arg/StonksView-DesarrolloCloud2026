// Aritmética decimal exacta para montos y cantidades.
//
// Los `numeric` de Postgres llegan como string o number, y sumarlos como
// `number` de JS acumula error binario (0.1 + 0.2 = 0.30000000000000004).
// Un Decimal es un entero BigInt más una escala: valor = units / 10^scale.
// Suma, resta y multiplicación son exactas; la división solo se usa para
// porcentajes y redondea a una cantidad fija de decimales.

export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

export type DecimalInput = string | number | Decimal;

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

export const ZERO: Decimal = { units: 0n, scale: 0 };

export function dec(input: DecimalInput): Decimal {
  if (typeof input === "object") return input;
  if (typeof input === "number" && !Number.isFinite(input)) {
    throw new RangeError(`Número no finito: ${input}`);
  }
  const text = String(input).trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new RangeError(`No es un número decimal válido: "${text}"`);

  const [, sign = "", intPart = "0", fracPart = "", expPart] = match;
  const exponent = expPart ? Number(expPart) : 0;
  let units = BigInt(intPart + fracPart);
  let scale = fracPart.length - exponent;
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return normalize({ units: sign === "-" ? -units : units, scale });
}

export function add(a: DecimalInput, b: DecimalInput): Decimal {
  const [x, y] = align(dec(a), dec(b));
  return normalize({ units: x.units + y.units, scale: x.scale });
}

export function sub(a: DecimalInput, b: DecimalInput): Decimal {
  const [x, y] = align(dec(a), dec(b));
  return normalize({ units: x.units - y.units, scale: x.scale });
}

export function mul(a: DecimalInput, b: DecimalInput): Decimal {
  const x = dec(a);
  const y = dec(b);
  return normalize({ units: x.units * y.units, scale: x.scale + y.scale });
}

export function sum(values: Iterable<DecimalInput>): Decimal {
  let total = ZERO;
  for (const value of values) total = add(total, value);
  return total;
}

export function compare(a: DecimalInput, b: DecimalInput): -1 | 0 | 1 {
  const [x, y] = align(dec(a), dec(b));
  return x.units < y.units ? -1 : x.units > y.units ? 1 : 0;
}

export function isZero(a: DecimalInput): boolean {
  return dec(a).units === 0n;
}

// a / b redondeado a `digits` decimales (mitad lejos de cero).
// Devuelve null si b es cero.
export function divide(a: DecimalInput, b: DecimalInput, digits: number): Decimal | null {
  const x = dec(a);
  const y = dec(b);
  if (y.units === 0n) return null;

  // a/b = (x.units * 10^y.scale) / (y.units * 10^x.scale)
  let numerator = x.units * 10n ** BigInt(y.scale + digits);
  let denominator = y.units * 10n ** BigInt(x.scale);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= denominator) quotient += numerator < 0n ? -1n : 1n;
  return normalize({ units: quotient, scale: digits });
}

// Porcentaje que representa `part` sobre `total`, con `digits` decimales.
export function percent(part: DecimalInput, total: DecimalInput, digits = 2): Decimal | null {
  return divide(mul(part, 100), total, digits);
}

export function toString(a: DecimalInput): string {
  const { units, scale } = dec(a);
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${intPart}${fracPart ? `.${fracPart}` : ""}`;
}

// Con una cantidad fija de decimales, completando con ceros (para mostrar %).
export function toFixed(a: DecimalInput, digits: number): string {
  const rounded = divide(a, 1, digits) ?? ZERO;
  const text = toString(rounded);
  if (digits === 0) return text;
  const [intPart, fracPart = ""] = text.split(".");
  return `${intPart}.${fracPart.padEnd(digits, "0")}`;
}

function align(a: Decimal, b: Decimal): [Decimal, Decimal] {
  if (a.scale === b.scale) return [a, b];
  if (a.scale > b.scale) {
    return [a, { units: b.units * 10n ** BigInt(a.scale - b.scale), scale: a.scale }];
  }
  return [{ units: a.units * 10n ** BigInt(b.scale - a.scale), scale: b.scale }, b];
}

// Saca ceros a la derecha para que la escala no crezca sin límite.
function normalize(value: Decimal): Decimal {
  let { units, scale } = value;
  if (units === 0n) return ZERO;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
}
