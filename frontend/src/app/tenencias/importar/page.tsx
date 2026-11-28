"use client";

import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/auth-guards";
import { CsvImportScreen } from "@/components/csv-import";

// Importación masiva de tenencias por CSV (tarea 4.7, pantalla P10).
export default function ImportCsvPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">
          <CsvImportScreen />
        </main>
      </div>
    </RequireAuth>
  );
}