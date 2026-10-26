/**
 * /admin entry (lazy chunk from main.tsx): the "Harbour Master" sign-in and dashboard.
 * Asks GET /api/admin/session once: 200 -> dashboard, 401 -> sign-in, 404 -> admin is turned off on
 * this server (ADMIN_PASSWORD_HASH unset). docs/admin/README.md has the whole feature.
 */
import { useEffect, useState } from "react";
import "./admin.css";
import { adminApi } from "./api";
import SignIn from "./SignIn";
import Dashboard from "./Dashboard";

// Page chrome: undo the game's full-screen layout, load the admin fonts, set the title.
document.documentElement.classList.add("hm-root");
document.title = "Harbour Master";
if (!document.getElementById("hm-fonts")) {
  const link = document.createElement("link");
  link.id = "hm-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Pirata+One&family=Alegreya+Sans:wght@400;500;700&display=swap";
  document.head.appendChild(link);
}
if (!document.querySelector('meta[name="robots"]')) {
  const meta = document.createElement("meta");
  meta.name = "robots";
  meta.content = "noindex, nofollow";
  document.head.appendChild(meta);
}

type Phase = "checking" | "signedOut" | "signedIn" | "disabled" | "offline";

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>("checking");

  const check = () => {
    adminApi
      .session()
      .then((r) => setPhase(r.ok ? "signedIn" : r.status === 404 ? "disabled" : "signedOut"))
      .catch(() => setPhase("offline"));
  };
  useEffect(check, []);

  return (
    <div className="hm">
      {phase === "checking" && <p className="hm-signin muted">Checking the harbour log...</p>}
      {phase === "signedOut" && <SignIn onSignedIn={() => setPhase("signedIn")} />}
      {phase === "signedIn" && <Dashboard onSignedOut={() => setPhase("signedOut")} />}
      {(phase === "disabled" || phase === "offline") && (
        <div className="hm-signin">
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 className="hm-title" style={{ fontSize: 36 }}>Harbour Master</h1>
            <p className="muted">
              {phase === "disabled"
                ? "Admin sign-in is turned off on this server."
                : "Can't reach the server."}
            </p>
            {phase === "offline" && (
              <button type="button" className="hm-ghost" onClick={check}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
