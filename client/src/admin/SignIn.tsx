/** Admin sign-in (draft "Login"): one password field. Wrong-password and lock messages come from the server. */
import { useRef, useState, type FormEvent } from "react";
import { adminApi } from "./api";

function minutes(sec: number): string {
  const m = Math.max(1, Math.ceil(sec / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi.login(password);
      if (r.ok) {
        setPassword("");
        onSignedIn();
        return;
      }
      if (r.status === 429) {
        const wait = minutes(r.body?.retryAfterSec ?? 900);
        setError(
          r.body?.scope === "global"
            ? `Too many wrong passwords. Sign-in is locked for everyone for ${wait}.`
            : `Too many wrong passwords. Sign-in is locked for ${wait}.`,
        );
      } else if (r.status === 401) {
        const left = r.body?.remaining;
        setError(
          typeof left === "number"
            ? left > 0
              ? `Wrong password. ${left} ${left === 1 ? "try" : "tries"} left before a 15-minute lock.`
              : "Wrong password. Sign-in is now locked for 15 minutes."
            : "Wrong password.",
        );
      } else if (r.status === 404) {
        setError("Admin sign-in is turned off on this server.");
      } else {
        setError("Something went wrong. Try again.");
      }
    } catch {
      setError("Can't reach the server.");
    } finally {
      setBusy(false);
      inputRef.current?.select();
    }
  };

  return (
    <div className="hm-signin">
      <form onSubmit={submit} aria-labelledby="hm-signin-title">
        <div>
          <h1 id="hm-signin-title" className="hm-title" style={{ fontSize: 36 }}>
            Harbour Master
          </h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            piratetradewars.com/admin
          </p>
        </div>
        <div className="hm-field">
          <label htmlFor="hm-pw">Admin password</label>
          <input
            id="hm-pw"
            ref={inputRef}
            className="hm-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "hm-pw-error" : undefined}
          />
        </div>
        {error && (
          <p id="hm-pw-error" className="hm-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="hm-primary" disabled={busy || !password}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="muted small" style={{ margin: 0, lineHeight: 1.45 }}>
          Only Theo's admin password works here. Five wrong tries locks sign-in for 15 minutes. Every action you take is logged.
        </p>
      </form>
    </div>
  );
}
