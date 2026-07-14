"use client";

import { useState } from "react";
import { authClient } from "./_lib/auth-client";

/**
 * Sign-out control shown on the private dashboard (item 020). Ends the
 * better-auth session, then leaves for /sign-in.
 *
 * Navigation is a HARD load (window.location), not a client router push:
 * it forces a fresh server round-trip so the dashboard's session re-check
 * runs and the browser's bfcache / router cache cannot serve the just-viewed
 * private page after logout. The navigation runs in `finally` so a failed
 * sign-out still leaves the private page (and re-checks the session) rather
 * than stranding the button.
 */
export function SignOut({ email }: { email: string }): React.JSX.Element {
  const [pending, setPending] = useState(false);
  return (
    <span className="signout">
      <span className="email">{email}</span>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            await authClient.signOut();
          } finally {
            window.location.href = "/sign-in";
          }
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </span>
  );
}
