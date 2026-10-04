import Link from "next/link";

import { GuestButton } from "@/components/auth/GuestButton";

export default function DeniedPage() {
  return (
    <main className="flex min-h-[100svh] items-center justify-center p-6">
      <section
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-card border border-line bg-paper p-8 text-center shadow-[0_18px_48px_rgba(88,74,58,0.1)]"
        aria-labelledby="denied-title"
      >
        <h1
          id="denied-title"
          className="font-title text-[1.85rem] font-semibold leading-tight text-ink"
        >
          Access denied
        </h1>
        <p className="text-base leading-relaxed text-muted">
          This account is not allowed to continue.
        </p>
        <div className="w-full">
          <GuestButton />
        </div>
        <Link
          className="font-semibold text-[#425f58] underline underline-offset-[3px]"
          href="/login"
        >
          Back to login
        </Link>
      </section>
    </main>
  );
}
