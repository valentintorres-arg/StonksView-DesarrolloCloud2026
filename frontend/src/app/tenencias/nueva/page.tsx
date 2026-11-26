"use client";

import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/auth-guards";
import { NewHoldingScreen } from "@/components/holding-form";

// Alta manual de tenencias (3.2).
export default function NewHoldingPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">
          <NewHoldingScreen />
        </main>
      </div>
    </RequireAuth>
  );
}
