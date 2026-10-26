import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { cityDebug } from "./lib/world/cityDebug";
import { captureLandingSource } from "./lib/source";

// /admin is the Harbour Master dashboard (client/src/admin/, docs/admin/README.md): a separate lazy chunk,
// so neither the game nor three.js is loaded there. The game (App) is lazy too, so /admin never pulls it in.
const isAdmin = /^\/admin(\/|$)/.test(window.location.pathname);
const AdminPage = lazy(() => import("./admin/AdminPage"));
const App = lazy(() => import("./App"));

// Dev-only city-kit gallery (lib/city/README.md): /?citydebug=1&citygallery=1
const CityGallery = lazy(() => import("./components/dev/CityGallery"));
const showGallery = !isAdmin && cityDebug.enabled && new URLSearchParams(window.location.search).has("citygallery");

// Where this visitor came from (utm / ref / referrer): once per session, game pages only.
if (!isAdmin) captureLandingSource();

createRoot(document.getElementById("root")!).render(
  isAdmin ? (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  ) : showGallery ? (
    <Suspense fallback={null}>
      <CityGallery />
    </Suspense>
  ) : (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </QueryClientProvider>
  ),
);
