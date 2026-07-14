"use client";

import { useState } from "react";
import { authClient } from "../_lib/auth-client";

/**
 * Client-side Google sign-in trigger (item 020). Starts better-auth's OAuth
 * flow, which redirects to Google and back to /api/auth/callback/google,
 * then to `callbackURL`. Only rendered when Google is configured (the
 * server component gates on `configuredAuthMethods`).
 *
 * On success the browser navigates away to Google, so `pending` stays set as
 * the page unloads. On failure better-auth resolves with `{ error }` (or the
 * promise rejects) rather than redirecting — so we surface the error and
 * reset, otherwise the button would spin on "Redirecting…" forever.
 */
export function GoogleSignIn(): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const result = await authClient.signIn.social({
              provider: "google",
              callbackURL: "/",
            });
            if (result?.error) {
              setError(
                result.error.message ?? "Sign-in failed. Please try again.",
              );
              setPending(false);
            }
            // Success path: the client redirects to Google; the page unloads.
          } catch {
            setError("Sign-in failed. Please try again.");
            setPending(false);
          }
        }}
      >
        {pending ? "Redirecting…" : "Continue with Google"}
      </button>
      {error && (
        <p className="framing" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
