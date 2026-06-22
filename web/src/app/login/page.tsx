export const dynamic = "force-dynamic";

/** Single-password lock screen. Posts to /api/login, which sets the signed session cookie and
 * redirects back to `from`. Reachable unauthenticated (excluded from the middleware matcher). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const from = sp?.from && sp.from.startsWith("/") ? sp.from : "/";
  const error = sp?.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 font-sans text-stone-900 dark:text-stone-100">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        <h1 className="text-xl font-bold tracking-tight">Massif</h1>
        <p className="mt-1 mb-5 text-sm text-stone-500 dark:text-stone-400">
          Entre le mot de passe pour accéder à ton espace.
        </p>
        <form action="/api/login" method="POST" className="space-y-3">
          <input type="hidden" name="from" value={from} />
          <input
            type="password"
            name="password"
            autoFocus
            required
            placeholder="Mot de passe"
            autoComplete="current-password"
            className="w-full rounded-lg border border-stone-300 bg-page px-3 py-2 text-sm tracking-wide outline-none transition-colors focus:border-alpine-500 focus:ring-2 focus:ring-alpine-500/30 dark:border-stone-700 dark:bg-stone-950"
          />
          {error && <p className="text-sm text-rest">Mot de passe incorrect.</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Entrer
          </button>
        </form>
      </div>
    </div>
  );
}
