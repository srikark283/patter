import React from "react";
import ReactDOM from "react-dom/client";
import Dashboard from "../features/dashboard/Dashboard";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../index.css";
import { applyTheme, getTheme, watchSystemTheme } from "@/lib/theme";

// Before first paint: dashboard.html ships class="dark" so the window never
// flashes white on a dark-themed launch; this corrects it if the user chose
// light, and keeps "system" live afterwards.
applyTheme(getTheme());
watchSystemTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <Dashboard />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>
);

