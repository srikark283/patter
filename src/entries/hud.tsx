import React from "react";
import ReactDOM from "react-dom/client";
import Hud from "../features/hud/Hud";
// Before index.css so the @font-face rules land first; see the note there for
// why these can't be CSS @imports.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Hud />
  </React.StrictMode>,
);
