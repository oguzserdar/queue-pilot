"use client";

import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

/**
 * Browser-side Better Auth client. oauthProviderClient forwards the signed oauth_query on every call,
 * so signing in on /sign-in during a ChatGPT/Claude/Grok connection resumes that connection afterwards.
 */
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
