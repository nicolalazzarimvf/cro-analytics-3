import "./globals.css";
import type { ReactNode } from "react";
import { getServerAuthSession } from "@/lib/auth/server";
import AppShell from "@/app/components/AppShell";
import LoginWall from "@/app/components/LoginWall";

export const metadata = {
  title: "CROmatic — AI-powered CRO analyst",
  description: "CROmatic by MVF — AI-powered CRO analyst",
  icons: {
    icon: "/images/analytics-logo.png",
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getServerAuthSession();
  const isAuthenticated = !!session?.user;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent dark-mode flash: set .dark before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = localStorage.getItem('theme');
                if (t !== 'light') {
                  document.documentElement.classList.add('dark');
                  document.documentElement.style.colorScheme = 'dark';
                } else {
                  document.documentElement.classList.remove('dark');
                  document.documentElement.style.colorScheme = 'light';
                }
                if (localStorage.getItem('sidebar-expanded') === 'true') {
                  document.body && document.body.classList.add('sidebar-expanded');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="font-inter antialiased bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400">
        {isAuthenticated ? (
          <AppShell userEmail={session?.user?.email}>
            {children}
          </AppShell>
        ) : (
          <LoginWall />
        )}
      </body>
    </html>
  );
}
