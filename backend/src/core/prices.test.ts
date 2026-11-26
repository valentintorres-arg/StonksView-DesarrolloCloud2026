import { describe, expect, it, vi } from "vitest";
import type { PriceRow } from "./dashboard";
import { type Asset, type PriceProvider, type PriceQuote, refreshStalePrices } from "./prices";

const NOW = new Date("2026-11-26T12:00:00Z");
const MINUTES_AGO = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function row(symbol: string, price: string, fetchedAt: string, source = "coingecko", assetClass = "crypto"): PriceRow {
  return { symbol, asset_class: assetClass, source, price, currency: "USD", fetched_at: fetchedAt };
}

function provider(source: string, classes: string[], quotes: (assets: Asset[]) => PriceQuote[] | Promise<PriceQuote[]>) {
  return {
    source,
    supports: (assetClass: string) => classes.includes(assetClass),
    fetch: vi.fn(async (assets: Asset[]) => quotes(assets)),
  } satisfies PriceProvider;
}

const quote = (symbol: string, price: string, assetClass = "crypto"): PriceQuote => ({
  symbol,
  assetClass,
  price,
  currency: "USD",
  changePercent24h: null,
});

const crypto = (symbol: string): Asset => ({ symbol, assetClass: "crypto" });

describe("refreshStalePrices", () => {
  it("no llama al proveedor si el precio tiene menos de 5 minutos", async () => {
    const gecko = provider("coingecko", ["crypto"], () => []);
    const cached = [row("BTC", "60000", MINUTES_AGO(4))];

    const rows = await refreshStalePrices([crypto("BTC")], cached, { providers: [gecko], writer: null, now: () => NOW, onError: vi.fn() });

    expect(gecko.fetch).not.toHaveBeenCalled();
    expect(rows).toBe(cached);
  });

  it("pide solo los vencidos o faltantes, una vez por activo, y los guarda", async () => {
    const gecko = provider("coingecko", ["crypto"], (assets) => assets.map((a) => quote(a.symbol, "2")));
    const writer = { upsert: vi.fn(async () => undefined) };
    const cached = [row("BTC", "60000", MINUTES_AGO(1)), row("ETH", "1500", MINUTES_AGO(30))];

    const rows = await refreshStalePrices(
      [crypto("BTC"), crypto("ETH"), crypto("eth"), crypto("SOL")],
      cached,
      { providers: [gecko], writer, now: () => NOW, onError: vi.fn() },
    );

    expect(gecko.fetch).toHaveBeenCalledWith([crypto("ETH"), crypto("SOL")]);
    const written = [
      { ...row("ETH", "2", NOW.toISOString()), change_percent_24h: null },
      { ...row("SOL", "2", NOW.toISOString()), change_percent_24h: null },
    ];
    expect(writer.upsert).toHaveBeenCalledWith(written);
    // El ETH viejo se reemplaza; el BTC vigente queda.
    expect(rows).toEqual([cached[0], ...written]);
  });

  it("un precio de otra fuente (carga manual) no cuenta como vigente para el proveedor", async () => {
    const gecko = provider("coingecko", ["crypto"], () => [quote("BTC", "61000")]);
    const manual = row("BTC", "50000", MINUTES_AGO(1), "manual");

    const rows = await refreshStalePrices([crypto("BTC")], [manual], { providers: [gecko], writer: null, now: () => NOW, onError: vi.fn() });

    expect(gecko.fetch).toHaveBeenCalledOnce();
    expect(rows.map((r) => r.source)).toEqual(["manual", "coingecko"]);
  });

  it("cada clase va a su proveedor y las no soportadas no se piden", async () => {
    const gecko = provider("coingecko", ["crypto"], () => []);
    const yahoo = provider("yahoo", ["stock", "etf", "cedear"], () => []);

    await refreshStalePrices(
      [crypto("BTC"), { symbol: "AAPL", assetClass: "stock" }, { symbol: "EURUSD", assetClass: "forex" }],
      [],
      { providers: [gecko, yahoo], writer: null, now: () => NOW, onError: vi.fn() },
    );

    expect(gecko.fetch).toHaveBeenCalledWith([crypto("BTC")]);
    expect(yahoo.fetch).toHaveBeenCalledWith([{ symbol: "AAPL", assetClass: "stock" }]);
  });

  it("si un proveedor falla se sigue con el cache viejo y con los demás proveedores", async () => {
    const error = new Error("timeout");
    const gecko = provider("coingecko", ["crypto"], () => Promise.reject(error));
    const yahoo = provider("yahoo", ["stock"], () => [quote("AAPL", "355", "stock")]);
    const onError = vi.fn();
    const old = row("BTC", "58000", MINUTES_AGO(120));

    const rows = await refreshStalePrices([crypto("BTC"), { symbol: "AAPL", assetClass: "stock" }], [old], {
      providers: [gecko, yahoo],
      writer: null,
      now: () => NOW,
      onError,
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(rows.map((r) => [r.symbol, r.price])).toEqual([
      ["BTC", "58000"],
      ["AAPL", "355"],
    ]);
  });

  it("si falla el guardado igual devuelve los precios nuevos", async () => {
    const gecko = provider("coingecko", ["crypto"], () => [quote("BTC", "61000")]);
    const onError = vi.fn();
    const writer = { upsert: vi.fn(async () => Promise.reject(new Error("permiso denegado"))) };

    const rows = await refreshStalePrices([crypto("BTC")], [], { providers: [gecko], writer, now: () => NOW, onError });

    expect(onError).toHaveBeenCalledOnce();
    expect(rows.map((r) => r.price)).toEqual(["61000"]);
  });

  it("descarta cotizaciones de activos que no se pidieron", async () => {
    const gecko = provider("coingecko", ["crypto"], () => [quote("BTC", "61000"), quote("ETH", "1")]);
    const writer = { upsert: vi.fn(async () => undefined) };

    const rows = await refreshStalePrices([crypto("BTC")], [], { providers: [gecko], writer, now: () => NOW, onError: vi.fn() });

    expect(rows.map((r) => r.symbol)).toEqual(["BTC"]);
  });
});
