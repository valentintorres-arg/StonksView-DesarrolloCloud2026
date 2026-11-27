"use client";

import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/auth-guards";
import { Status } from "@/components/feedback";
import { TransferScreen } from "@/components/transfer";

// Transferencia interna (P6). El lote de origen puede venir en la query
// (?id=) desde la pantalla de tenencias.
export default function TransferPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">
          <Suspense fallback={<Status>Cargando…</Status>}>
            <TransferScreen />
          </Suspense>
        </main>
      </div>
    </RequireAuth>
  );
}
