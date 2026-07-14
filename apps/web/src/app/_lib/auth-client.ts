"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side better-auth client (item 020). Used by the sign-in button to
 * start an OAuth flow (`authClient.signIn.social`) and by any client
 * component that needs session state. baseURL is inferred from the current
 * origin, so no build-time config is needed.
 */
export const authClient = createAuthClient();
