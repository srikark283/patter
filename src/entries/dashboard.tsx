import React from "react";
import ReactDOM from "react-dom/client";
import Dashboard from "../features/dashboard/Dashboard";
import { Toaster } from "@/components/ui/sonner";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Dashboard />
    <Toaster />
  </React.StrictMode>
);
