import type { ReactNode } from "react";

/**
 * Layout for the signed-out screens. Confetti motif stays subtle —
 * this is a business tool first (Spec 2.1).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="confetti-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      {children}
    </main>
  );
}
