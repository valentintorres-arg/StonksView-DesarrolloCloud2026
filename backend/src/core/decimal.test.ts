import { describe, expect, it } from "vitest";
import { add, compare, dec, divide, mul, percent, sub, sum, toFixed, toString } from "./decimal";

describe("decimal", () => {
  it("suma sin el error de punto flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toString(add(0.1, 0.2))).toBe("0.3");
    expect(toString(sum(["0.1", "0.2", "0.3"]))).toBe("0.6");
  });

  it("parsea strings, números y notación exponencial", () => {
    expect(toString(dec("00012.3400"))).toBe("12.34");
    expect(toString(dec(-5))).toBe("-5");
    expect(toString(dec(1e-8))).toBe("0.00000001");
    expect(toString(dec("2.5e3"))).toBe("2500");
  });

  it("rechaza valores que no son números", () => {
    expect(() => dec("abc")).toThrow(RangeError);
    expect(() => dec(Number.NaN)).toThrow(RangeError);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("multiplica y resta con exactitud", () => {
    expect(toString(mul("0.00012345", "65432.1"))).toBe("8.077592745");
    expect(toString(sub("1", "1.000001"))).toBe("-0.000001");
    expect(toString(mul("3", "0"))).toBe("0");
  });

  it("divide redondeando mitad lejos de cero", () => {
    expect(toString(divide(1, 3, 4)!)).toBe("0.3333");
    expect(toString(divide(2, 3, 2)!)).toBe("0.67");
    expect(toString(divide("0.125", 1, 2)!)).toBe("0.13");
    expect(toString(divide("-0.125", 1, 2)!)).toBe("-0.13");
    expect(toString(divide(1, -8, 2)!)).toBe("-0.13");
    expect(divide(1, 0, 2)).toBeNull();
  });

  it("calcula porcentajes y los formatea con decimales fijos", () => {
    expect(toFixed(percent(1, 3)!, 2)).toBe("33.33");
    expect(toFixed(percent(1, 4)!, 2)).toBe("25.00");
    expect(toFixed(percent(0, 4)!, 2)).toBe("0.00");
    expect(percent(1, 0)).toBeNull();
  });

  it("compara valores con distinta escala", () => {
    expect(compare("1.50", "1.5")).toBe(0);
    expect(compare("2", "10")).toBe(-1);
    expect(compare("-1", "-2")).toBe(1);
  });
});
