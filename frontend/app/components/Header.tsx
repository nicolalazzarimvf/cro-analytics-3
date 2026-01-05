import Image from "next/image";
import Link from "next/link";
import { getServerAuthSession } from "@/lib/auth/server";

export default async function Header() {
  const session = await getServerAuthSession();

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <nav className="flex items-center gap-4 text-sm font-medium text-gray-700">
          <Link href="/" className="group flex items-center gap-2 text-gray-900">
            <Image
              src="/images/analytics-logo.png"
              alt="MVF"
              width={36}
              height={36}
              className="transition-transform group-hover:scale-[1.03]"
              priority
            />
            <span className="text-base font-semibold leading-tight">MVF CRO Analyst</span>
          </Link>
          <Link href="/experiments" className="hover:text-gray-900">
            Experiments
          </Link>
          <Link href="/stats" className="hover:text-gray-900">
            Stats
          </Link>
          <Link href="/how-it-works" className="hover:text-gray-900">
            How it works
          </Link>
          <Link href="/admin" className="hover:text-gray-900">
            Admin
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-600 sm:inline">
            {session?.user?.email ?? "Not signed in"}
          </span>
          {session ? (
            <Link
              href="/api/auth/signout"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Logout
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
