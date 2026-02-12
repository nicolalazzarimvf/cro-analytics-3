"use client";

import { useState, ReactNode } from "react";
import Sidebar from "./Sidebar";
import DashboardHeader from "./DashboardHeader";
import { ThemeProvider } from "@/app/context/ThemeContext";

type Props = {
  children: ReactNode;
  userEmail?: string | null;
};

export default function AppShell({ children, userEmail }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ThemeProvider>
      <div className="flex h-[100dvh] overflow-hidden">
        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        <div className="relative flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
          <DashboardHeader
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            userEmail={userEmail}
          />
          <main className="grow">
            <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-[96rem] mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
