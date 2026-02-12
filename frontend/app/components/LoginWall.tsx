"use client";

import { signIn } from "next-auth/react";
import { ThemeProvider } from "@/app/context/ThemeContext";
import ThemeToggle from "./ThemeToggle";

export default function LoginWall() {
  return (
    <ThemeProvider>
      <div className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 px-6 py-12 overflow-hidden">
        {/* Theme toggle in top-right */}
        <div className="absolute top-5 right-5 z-10">
          <ThemeToggle />
        </div>

        {/* Decorative gradient orbs */}
        <div
          className="pointer-events-none absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #8b5cf6, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -right-32 h-[400px] w-[400px] rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #06b6d4, transparent 70%)" }}
        />

        {/* Card */}
        <div className="relative z-10 w-full max-w-md">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-8 shadow-xl dark:shadow-none text-center">
            {/* MVF Logo */}
            <div className="mx-auto mb-5">
              <img
                src="/images/MVF_Logo_White.svg"
                alt="MVF"
                className="mx-auto h-6 hidden dark:block opacity-50"
              />
              <img
                src="/images/MVF_Logo_Navy.svg"
                alt="MVF"
                className="mx-auto h-6 dark:hidden opacity-40"
              />
            </div>

            {/* Title */}
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              CROmatic
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              AI-powered CRO analyst
            </p>

            {/* Divider */}
            <div className="my-6 h-px bg-gray-200 dark:bg-gray-700/60" />

            {/* Description */}
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Explore experiment data, discover patterns with knowledge graphs, and get
              AI-driven insights to accelerate your CRO programme.
            </p>

            {/* Sign-in button */}
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: "/" })}
              className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-violet-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:bg-violet-600 hover:shadow-violet-500/40 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              {/* Google icon */}
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#fff"
                  fillOpacity={0.8}
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#fff"
                  fillOpacity={0.8}
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
                  fill="#fff"
                  fillOpacity={0.8}
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#fff"
                  fillOpacity={0.8}
                />
              </svg>
              Sign in with Google
            </button>

            {/* Footer note */}
            <p className="mt-5 text-xs text-gray-400 dark:text-gray-500">
              Access restricted to authorised team members
            </p>
          </div>

          {/* Powered by */}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span>Powered by</span>
            <img
              src="/images/MVF_Logo_Navy.svg"
              alt="MVF"
              className="h-4 opacity-40 dark:invert dark:opacity-30"
            />
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
