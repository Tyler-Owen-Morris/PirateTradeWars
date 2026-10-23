import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { cityDebug } from "./lib/world/cityDebug";

// Dev-only city-kit gallery (lib/city/README.md): /?citydebug=1&citygallery=1
const CityGallery = lazy(() => import("./components/dev/CityGallery"));
const showGallery = cityDebug.enabled && new URLSearchParams(window.location.search).has("citygallery");

createRoot(document.getElementById("root")!).render(
  showGallery ? (
    <Suspense fallback={null}>
      <CityGallery />
    </Suspense>
  ) : (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  ),
);