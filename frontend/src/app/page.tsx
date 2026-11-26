"use client";

import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/auth-guards";
import { Dashboard } from "@/components/dashboard";

// Inicio privado: el dashboard consolidado (3.3).
export default function Home() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex-1">
          <Dashboard />
        </main>
      </div>
    </RequireAuth>
  );
}
