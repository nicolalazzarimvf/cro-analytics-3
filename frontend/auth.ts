import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";

function parseAllowlist(value: string | undefined) {
  if (!value) return null;
  const entries = value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return entries.length ? new Set(entries) : null;
}

const allowlist = parseAllowlist(process.env.AUTH_ALLOWED_EMAILS);

/**
 * Use the refresh token to obtain a fresh access token from Google.
 * Returns the updated token object, or marks it with an error on failure.
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const url = new URL("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: token.refreshToken as string,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[auth] Failed to refresh access token:", data);
      return { ...token, error: "RefreshAccessTokenError" };
    }

    console.log("[auth] Access token refreshed successfully");

    return {
      ...token,
      accessToken: data.access_token as string,
      // Google returns expires_in in seconds; store the absolute expiry time
      accessTokenExpires: Date.now() + (data.expires_in as number) * 1000,
      // Google may issue a new refresh token; keep the old one if not
      refreshToken: (data.refresh_token as string) ?? token.refreshToken,
      error: undefined,
    };
  } catch (err) {
    console.error("[auth] Error refreshing access token:", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          // Request Sheets read access for the import pipeline.
          scope:
            "openid email profile https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
          // Required to receive a refresh_token from Google.
          access_type: "offline",
          prompt: "consent"
        }
      }
    })
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login"
  },
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!allowlist) return true;
      return allowlist.has(email);
    },
    async jwt({ token, account }) {
      // Initial sign-in: persist access token, refresh token, and expiry
      if (account) {
        return {
          ...token,
          accessToken: account.access_token as string,
          refreshToken: account.refresh_token as string,
          // Google tokens expire in ~3600s; store absolute expiry with 60s safety margin
          accessTokenExpires: Date.now() + ((account.expires_at ?? 3600) as number) * 1000 - 60_000,
        };
      }

      // Subsequent requests: return token if it hasn't expired yet
      if (typeof token.accessTokenExpires === "number" && Date.now() < token.accessTokenExpires) {
        return token;
      }

      // Access token has expired — try to refresh it
      if (token.refreshToken) {
        return refreshAccessToken(token);
      }

      // No refresh token available — can't refresh
      return { ...token, error: "NoRefreshToken" };
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).accessToken = token.accessToken;
        // Expose token error so the client can prompt re-login if needed
        if (token.error) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (session as any).error = token.error;
        }
      }
      return session;
    }
  }
};
