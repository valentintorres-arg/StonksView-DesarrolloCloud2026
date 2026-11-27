"use client";

import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/auth-guards";
import { Status } from "@/components/feedback";
import { HoldingsScreen } from "@/components/holdings";

// Tenencias agrupadas por posición (P4).
export default function HoldingsPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">
          {/* useSearchParams necesita Suspense en el export estático. */}
          <Suspense fallback={<Status>Cargando…</Status>}>
            <HoldingsScreen />
          </Suspense>
        </main>
      </div>
    </RequireAuth>
  );
}
