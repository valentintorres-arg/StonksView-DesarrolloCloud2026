// Estados de carga y error compartidos por las pantallas.

export function Status({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="py-16 text-center text-sm text-neutral-500">
      {children}
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
        Reintentar
      </button>
    </div>
  );
}
