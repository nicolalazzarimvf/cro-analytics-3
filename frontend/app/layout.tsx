import "./globals.css";
import type { ReactNode } from "react";
import Header from "@/app/components/Header";

export const metadata = {
  title: "CRO Analyst",
  description: "CRO Analyst v3",
  icons: {
    icon: "/images/analytics-logo.png"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
        <footer className="mt-12 border-t border-gray-200 bg-white px-6 py-6 text-sm text-gray-600">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span>Copyright 2025 MVF Global</span>
            <span className="flex flex-wrap items-center gap-2 text-sm">
              For more info contact Nicola Lazzari or Stefanie Evans on Slack |
              <a
                href="slack://user?email=nicola.lazzari@mvfglobal.com"
                className="text-brand-700 hover:underline"
              >
                DM Nicola
              </a>
              /
              <a
                href="slack://user?email=stefanie.evans@mvfglobal.com"
                className="text-brand-700 hover:underline"
              >
                DM Stefanie
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
