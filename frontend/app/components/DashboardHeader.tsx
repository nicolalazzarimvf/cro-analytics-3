"use client";

import ThemeToggle from "./ThemeToggle";
import Link from "next/link";

type Props = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  userEmail?: string | null;
};

export default function DashboardHeader({ sidebarOpen, setSidebarOpen, userEmail }: Props) {
  return (
    <header className="sticky top-0 before:absolute before:inset-0 before:backdrop-blur-md max-lg:before:bg-white/90 dark:max-lg:before:bg-gray-800/90 before:bg-white after:absolute after:h-px after:inset-x-0 after:top-full after:bg-gray-200 dark:after:bg-gray-700/60 after:-z-10 before:-z-10 z-30 dark:before:bg-gray-800">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: hamburger + brand */}
          <div className="flex items-center gap-3">
            <button
              className="text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 lg:hidden"
              aria-controls="sidebar"
              aria-expanded={sidebarOpen}
              onClick={(e) => {
                e.stopPropagation();
                setSidebarOpen(!sidebarOpen);
              }}
            >
              <span className="sr-only">Open sidebar</span>
              <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                <rect x="4" y="5" width="16" height="2" />
                <rect x="4" y="11" width="16" height="2" />
                <rect x="4" y="17" width="16" height="2" />
              </svg>
            </button>
            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <img
                src="/images/MVF_Logo_White.svg"
                alt="MVF"
                className="h-4 hidden dark:block"
              />
              <img
                src="/images/MVF_Logo_Navy.svg"
                alt="MVF"
                className="h-4 dark:hidden"
              />
              <div className="h-5 w-px bg-gray-300 dark:bg-gray-600" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tracking-tight">CROmatic</span>
                <span className="hidden sm:inline text-xs text-gray-400 dark:text-gray-500">AI-powered CRO analyst</span>
              </div>
            </div>
          </div>

          {/* Right: theme toggle + user */}
          <div className="flex items-center space-x-3">
            <ThemeToggle />

            {/* User info */}
            {userEmail ? (
              <div className="flex items-center gap-3">
                <span className="hidden text-sm text-gray-500 dark:text-gray-400 sm:inline truncate max-w-[200px]">
                  {userEmail}
                </span>
                <Link
                  href="/api/auth/signout"
                  className="btn bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                >
                  Logout
                </Link>
              </div>
            ) : (
              <Link
                href="/login"
                className="btn bg-violet-500 hover:bg-violet-600 text-white"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
