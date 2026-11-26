"use client";

import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/auth-guards";
import { Status } from "@/components/feedback";
import { EditHoldingScreen } from "@/components/holding-edit";

// Edición de un lote. El id va en la query (?id=) porque el export estático
// no puede generar una página por cada lote.
export default function EditHoldingPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">
          <Suspense fallback={<Status>Cargando…</Status>}>
            <EditHoldingScreen />
          </Suspense>
        </main>
      </div>
    </RequireAuth>
  );
}
