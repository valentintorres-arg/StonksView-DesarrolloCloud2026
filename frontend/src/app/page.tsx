"use client";

import { RequireAuth } from "@/components/auth-guards";
import { useAuth } from "@/lib/auth";

// Inicio privado. El dashboard consolidado (3.3) se monta acá cuando esté la
// pantalla; por ahora muestra la sesión y permite salir.
export default function Home() {
  return (
    <RequireAuth>
      <HomeContent />
    </RequireAuth>
  );
}

function HomeContent() {
  const { auth, signOut } = useAuth();
  const email = auth.status === "signed-in" ? auth.session.user.email : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <span className="font-semibold">StonksView</span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-500">{email}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Cerrar sesión
          </button>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <h1 className="text-2xl font-bold">Tu patrimonio consolidado</h1>
        <p className="mt-2 text-neutral-500">El dashboard llega en la próxima entrega.</p>
      </main>
    </div>
  );
}
