import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/global.css";
import { startLightSource } from "./lib/lightSource";

// 커서 광원 — 화면 전체 그림자가 커서 반대편으로 함께 기운다(tokens.css의 --lx/--ly)
startLightSource();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
