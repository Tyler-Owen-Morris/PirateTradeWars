// Runtime switches read from environment variables. Read on every call (not cached at import) so
// tests can flip them and so the value always reflects the process environment.

/** SHIPS_FREE = "true" or "1" (case-insensitive, trimmed) makes every ship free: no Stripe charge. Anything else = charge. */
export function shipsFree(): boolean {
  const v = (process.env.SHIPS_FREE ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}
