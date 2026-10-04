"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GuestButton } from "@/components/auth/GuestButton";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}

function LoginCard() {
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const errorMessage =
    signInError ??
    (searchParams.get("error") === "oauth"
      ? "Sign-in failed. Please try again."
      : null);

  async function handleSignIn() {
    setIsLoading(true);
    setSignInError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/gate`,
      },
    });

    if (error) {
      setSignInError("Sign-in failed. Please try again.");
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-[100svh] items-center justify-center p-6">
      <section
        className="flex w-full max-w-sm flex-col gap-[18px] rounded-card border border-line bg-paper p-8 shadow-[0_18px_48px_rgba(88,74,58,0.12)]"
        aria-labelledby="login-title"
      >
        <h1
          id="login-title"
          className="text-center font-title text-3xl font-semibold text-ink"
        >
          Javi&apos;s Journal
        </h1>
        <button
          className="min-h-12 rounded-card bg-[#425f58] font-semibold text-[#fffdf9] transition-colors hover:not-disabled:bg-[#354e48] disabled:cursor-wait disabled:opacity-70"
          type="button"
          onClick={handleSignIn}
          disabled={isLoading}
        >
          {isLoading ? "Signing in..." : "Sign in with Google"}
        </button>
        <GuestButton />
        {errorMessage ? (
          <p className="text-center text-[0.95rem] leading-snug text-[#9c3b43]">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
