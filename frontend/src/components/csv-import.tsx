"use client";

import Link from "next/link";
import { useState } from "react";
import { PortfolioGate } from "@/components/portfolio-gate";
import { api, ApiError, type CsvLineError, type Portfolio } from "@/lib/api";

const SAMPLE_CSV = [
  "symbol,asset_class,quantity,cost_basis,source_type,source_name,acquired_at",
  "BTC,crypto,0.25,62000,exchange,Binance,2026-03-15",
  "ETH,crypto,1.5,3100,wallet,Ledger,2026-04-02",
  "SPY,etf,5,510.50,broker,IOL,2026-05-10",
].join("\n");

function previewLines(raw: string): string[][] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const first = lines[0] ?? "";
  const delimiter = first.includes(";") && !first.includes(",") ? ";" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

export function CsvImportScreen() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">Importar tenencias por CSV</h1>
      <PortfolioGate>{(portfolio) => <CsvImportForm key={portfolio.id} portfolio={portfolio} />}</PortfolioGate>
    </div>
  );
}

function CsvImportForm({ portfolio }: { portfolio: Portfolio }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<CsvLineError[]>([]);

  function handleDownloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stonksview-ejemplo.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setImportedCount(null);
    setErrorMessage(null);
    setLineErrors([]);

    if (!file) {
      setFileName(null);
      setCsvText("");
      return;
    }

    setFileName(file.name);
    setCsvText(await file.text());
  }

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    if (!csvText.trim()) return;

    setSubmitting(true);
    setImportedCount(null);
    setErrorMessage(null);
    setLineErrors([]);

    try {
      const result = await api.importHoldingsCsv(portfolio.id, csvText);
      setImportedCount(result.imported);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
        setLineErrors(err.errors);
      } else {
        setErrorMessage("No se pudo importar el archivo. Intentá de nuevo.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const preview = csvText ? previewLines(csvText) : [];

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-neutral-500">
          Cargá varios lotes de una sola vez en <strong className="text-neutral-900 dark:text-neutral-100">{portfolio.name}</strong>. Si alguna fila tiene errores, no se importa ninguna.
        </p>
        <button
          type="button"
          onClick={handleDownloadSample}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Descargar CSV de ejemplo
        </button>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
        <p className="font-medium text-neutral-800 dark:text-neutral-200">Columnas esperadas:</p>
        <code className="mt-1 block break-all">
          symbol, asset_class, quantity, cost_basis, source_type, source_name, acquired_at
        </code>
      </div>

      <form onSubmit={handleImport} className="space-y-4">
        <div>
          <label htmlFor="csv-file" className="block text-sm font-medium">
            Archivo CSV
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="mt-2 block w-full text-sm text-neutral-500 file:mr-4 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-neutral-50 dark:file:border-neutral-700 dark:file:text-neutral-200 dark:hover:file:bg-neutral-900"
          />
          {fileName && <p className="mt-1 text-xs text-neutral-500">Seleccionado: {fileName}</p>}
        </div>

        {preview.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Vista previa (primeras filas)</p>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="min-w-full divide-y divide-neutral-200 text-left text-xs dark:divide-neutral-800">
                <thead className="bg-neutral-50 dark:bg-neutral-900/60">
                  <tr>
                    {preview[0]?.map((cell, i) => (
                      <th key={i} className="px-3 py-2 font-medium text-neutral-500">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
                  {preview.slice(1).map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="px-3 py-2 tabular-nums">
                          {cell || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={!csvText.trim() || submitting}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {submitting ? "Importando…" : "Importar tenencias"}
          </button>
          <Link href="/tenencias/" className="text-sm text-neutral-500 hover:underline">
            Volver a tenencias
          </Link>
        </div>
      </form>

      {importedCount !== null && (
        <div
          role="status"
          className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          Se importaron <strong>{importedCount}</strong> tenencias correctamente.{" "}
          <Link href="/tenencias/" className="font-semibold underline">
            Ver tenencias
          </Link>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
        >
          <p className="font-medium">{errorMessage}</p>
          {lineErrors.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {lineErrors.map((err, i) => (
                <li key={i}>
                  <strong>Línea {err.line}</strong>
                  {err.field ? ` (${err.field})` : ""}: {err.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}