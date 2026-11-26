import { describe, expect, it, vi } from "vitest";
import { coinGeckoProvider, yahooProvider } from "./price-providers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("coinGeckoProvider", () => {
  it("pide todos los símbolos juntos y arma las cotizaciones en USD", async () => {
    const fetchMock = vi.fn(async (_url: URL) =>
      jsonResponse({
        btc: { usd: 60500.94, usd_24h_change: 0.75 },
        eth: { usd: 1696.46, usd_24h_change: null },
        zzz: { usd: null },
      }),
    );
    const provider = coinGeckoProvider(fetchMock as unknown as typeof fetch);

    const quotes = await provider.fetch([
      { symbol: "BTC", assetClass: "crypto" },
      { symbol: "eth", assetClass: "crypto" },
      { symbol: "ZZZ", assetClass: "crypto" },
    ]);

    const url = fetchMock.mock.calls[0]![0] as unknown as URL;
    expect(url.searchParams.get("symbols")).toBe("btc,eth,zzz");
    expect(url.searchParams.get("vs_currencies")).toBe("usd");
    expect(quotes).toEqual([
      { symbol: "BTC", assetClass: "crypto", price: "60500.94", currency: "USD", changePercent24h: "0.75" },
      { symbol: "eth", assetClass: "crypto", price: "1696.46", currency: "USD", changePercent24h: null },
    ]);
  });

  it("solo atiende cripto", () => {
    const provider = coinGeckoProvider(vi.fn() as unknown as typeof fetch);
    expect(provider.supports("crypto")).toBe(true);
    expect(provider.supports("stock")).toBe(false);
  });

  it("tira error si la API no responde 200", async () => {
    const provider = coinGeckoProvider((async () => jsonResponse({}, 429)) as unknown as typeof fetch);
    await expect(provider.fetch([{ symbol: "BTC", assetClass: "crypto" }])).rejects.toThrow("429");
  });
});

function chart(price: number, currency: string, previous?: number) {
  return { chart: { result: [{ meta: { regularMarketPrice: price, currency, chartPreviousClose: previous } }] } };
}

describe("yahooProvider", () => {
  it("cotiza acciones por ticker y CEDEAR por el ticker de BYMA en pesos", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/AAPL")) return jsonResponse(chart(355.58, "USD", 354.07));
      if (url.pathname.endsWith("/KO.BA")) return jsonResponse(chart(32020, "ARS"));
      return jsonResponse({}, 404);
    });
    const provider = yahooProvider(fetchMock as unknown as typeof fetch);

    const quotes = await provider.fetch([
      { symbol: "AAPL", assetClass: "stock" },
      { symbol: "KO", assetClass: "cedear" },
      { symbol: "NOEXISTE", assetClass: "etf" },
    ]);

    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ symbol: "AAPL", price: "355.58", currency: "USD" });
    expect(Number(quotes[0]!.changePercent24h)).toBeCloseTo(0.4265, 3);
    expect(quotes[1]).toEqual({ symbol: "KO", assetClass: "cedear", price: "32020", currency: "ARS", changePercent24h: null });
  });

  it("si falla un símbolo devuelve los demás; si fallan todos, tira error", async () => {
    const partial = yahooProvider((async (url: URL) =>
      url.pathname.endsWith("/AAPL") ? jsonResponse(chart(1, "USD")) : jsonResponse({}, 500)) as unknown as typeof fetch);
    await expect(
      partial.fetch([
        { symbol: "AAPL", assetClass: "stock" },
        { symbol: "MSFT", assetClass: "stock" },
      ]),
    ).resolves.toHaveLength(1);

    const down = yahooProvider((async () => jsonResponse({}, 500)) as unknown as typeof fetch);
    await expect(down.fetch([{ symbol: "AAPL", assetClass: "stock" }])).rejects.toThrow("500");
  });
});
