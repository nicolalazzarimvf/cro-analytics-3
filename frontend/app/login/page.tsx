import LoginButton from "./LoginButton";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const missingGoogleConfig =
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_ID === "replace-me" ||
    process.env.GOOGLE_CLIENT_SECRET === "replace-me";
  const missingNextAuthSecret =
    !process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET === "replace-me";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-64px)] max-w-xl items-center justify-center px-6 py-10">
      <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h1 className="text-xl font-semibold text-gray-900">Login</h1>
        <p className="mt-2 text-sm text-gray-600">
          Sign in to sync data and access the dashboard.
        </p>
      {missingNextAuthSecret || missingGoogleConfig ? (
        <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          OAuth is not fully configured. Check <code>frontend/.env.local</code> for{" "}
          <code>NEXTAUTH_SECRET</code>, <code>GOOGLE_CLIENT_ID</code>,{" "}
          <code>GOOGLE_CLIENT_SECRET</code>.
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-error-200 bg-error-50 p-4 text-sm text-error-800">
          Sign-in failed (<code>{error}</code>). For Google OAuth, verify:
          <ul className="mt-2 list-disc pl-5">
            <li>
              <code>NEXTAUTH_URL</code> matches your browser URL exactly (use{" "}
              <code>localhost</code> consistently)
            </li>
            <li>
              Google OAuth redirect URI includes <code>http://localhost:3000/api/auth/callback/google</code>
            </li>
            <li>
              <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code> come from the same OAuth client
            </li>
          </ul>
        </div>
      ) : null}
        <div className="mt-6">
          <LoginButton />
        </div>
      </div>
    </main>
  );
}
