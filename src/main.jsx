import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./styles/tokens.css";
import "./styles/global.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* The site is served from a project subpath (/AdSphere-deploy/ on GitHub
        Pages). Without a basename, BrowserRouter treats "/AdSphere-deploy/" as
        an unknown route, the "*" catch-all redirects the browser to the domain
        root (github.io/), and refreshing there shows GitHub's 404 page.
        BASE_URL is Vite's configured base ("/AdSphere-deploy/" in prod, "/" in
        dev), so this works in both environments. */}
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);