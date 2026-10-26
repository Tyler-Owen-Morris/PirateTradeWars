/**
 * Print an ADMIN_PASSWORD_HASH line for the admin dashboard (docs/admin/README.md).
 *
 *   npm run admin:hash -- '<password>'
 *   echo '<password>' | npm run admin:hash        (keeps it out of the process list; first line of stdin)
 *
 * Output: `scrypt:<saltHex>:<hashHex>` (scrypt N=16384 r=8 p=1, 64-byte key, 16-byte random salt), plus a
 * fresh random ADMIN_SESSION_SECRET suggestion on stderr. Nothing is stored or sent anywhere.
 */
import crypto from "crypto";
import { makePasswordHash, parsePasswordHash } from "../server/admin/auth";

async function readStdinLine(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

async function main() {
  const password = process.argv[2] ?? (await readStdinLine());
  if (!password) {
    console.error("usage: npm run admin:hash -- '<password>'   (or pipe the password on stdin)");
    process.exit(2);
  }
  if (password.length < 12) console.error("warning: use a long password (12+ characters; a passphrase is best)");
  const line = makePasswordHash(password);
  if (!parsePasswordHash(line)) throw new Error("internal: produced an unparseable hash");
  console.log(line);
  console.error(`ADMIN_SESSION_SECRET suggestion (new random value): ${crypto.randomBytes(32).toString("hex")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
