import { configuredAuthMethods } from "../_lib/auth";
import { GoogleSignIn } from "./GoogleSignIn";

/**
 * Sign-in page (item 020): offers only the methods actually configured. When
 * none are (no GOOGLE_CLIENT_ID/SECRET), it says so honestly rather than
 * showing a broken button — the same honest-degradation principle guardrail
 * 4 sets for capability-gated screens (ADR-0013). Read at request time
 * (force-dynamic) so it reflects the deployment's live env, not build-time.
 */
export const dynamic = "force-dynamic";

export default function SignInPage(): React.JSX.Element {
  const methods = configuredAuthMethods();
  return (
    <main>
      <h1>Sign in to Kestrel</h1>
      {methods.length === 0 ? (
        <p className="framing">
          No sign-in method is configured. Set <code>GOOGLE_CLIENT_ID</code> and{" "}
          <code>GOOGLE_CLIENT_SECRET</code> to enable Google sign-in (see{" "}
          <code>docs/deploy.md</code>).
        </p>
      ) : (
        <>
          {methods.includes("google") && <GoogleSignIn />}
          <p className="framing">
            Signing in creates your account automatically. Research candidates,
            not recommendations.
          </p>
        </>
      )}
    </main>
  );
}
