# Admin dashboard: "Harbour Master"

`https://piratetradewars.com/admin` is Theo's live view of the game: who is online, where they are on the
world chart, where they came from (social click-throughs), and one-click help for a captain: repair,
gold, a free ship upgrade. Only Theo's password opens it (no 2FA, owner's decision). Design: the approved
draft https://claude.ai/artifact/5aL76y2dNjj9wNXykvkvyw (dark slate, brass `#e0b45a`, Pirata One title,
Alegreya Sans body, tabular numbers). Build log: `NOTES.md` next to this file.

## Files

| Where | What |
|---|---|
| `server/admin/auth.ts` | scrypt password hash format + verify, HMAC session tokens, login limiter, client IP |
| `server/admin/routes.ts` | `/api/admin/*` and `POST /api/visit` (game deps injected) |
| `server/admin/live.ts` | live wiring: world snapshot, actions on `playerQueue`, Redis persistence |
| `server/admin/state.ts` | pure: captain rows (status / where / lat-lon), action validation + apply |
| `server/admin/stats.ts`, `counters.ts` | daily traffic counters (Redis, 90-day TTL), visit limiter |
| `shared/adminApi.ts` | wire types shared by server and page |
| `shared/source.ts` | traffic source classifier + sanitizer (client and server) |
| `client/src/lib/source.ts` | landing capture: sessionStorage + one `POST /api/visit` beacon |
| `client/src/admin/` | the page: `AdminPage` (session check), `SignIn`, `Dashboard`, `admin.css`, `api.ts`, `format.ts` |
| `scripts/admin-hash.ts` | `npm run admin:hash` |
| tests | `server/admin/__tests__/*`, `shared/__tests__/source.test.ts`, `client/src/admin/__tests__/format.test.ts` |

`client/src/main.tsx` renders the admin page for `/admin` and `/admin/...` as its own lazy chunk; the game
(`App`) is lazy too, so `/admin` never downloads the game or three.js. Express serves `/admin` through the
normal SPA catch-all (`server/vite.ts`), with an `X-Robots-Tag: noindex` header added by the admin routes.

## Environment variables

| Var | Value |
|---|---|
| `ADMIN_PASSWORD_HASH` | `scrypt:<saltHex>:<hashHex>`: `crypto.scryptSync(password, Buffer.from(saltHex,'hex'), 64, {N:16384, r:8, p:1})`, 16-byte salt. **Unset = admin is off**: every `/api/admin/*` path 404s and the page says "Admin sign-in is turned off". |
| `ADMIN_SESSION_SECRET` | random hex, at least 32 bytes (64 hex chars). Missing or short = admin off (a warning is logged). |
| `ADMIN_TZ` (optional) | IANA zone for "today" in the counters. Default `America/Los_Angeles`. |
| `ADMIN_TRUSTED_PROXY_HOPS` (optional) | proxies in front of node. Default 2 in production (ALB + nginx), 0 otherwise. Set it if Cloudflare is put in front (`docs/infra/SINGLE_INSTANCE_CUTOVER.md`): Cloudflare -> nginx (no ALB) is also 2; Cloudflare -> ALB -> nginx is 3. |

Both values are runtime-only EB environment variables. A deploy does not overwrite EB env vars
(`deploy.yml` only passes the ASG sizes), so they survive releases.

## Set or rotate the password

1. Make a hash on your own machine (nothing is sent anywhere):
   `npm run admin:hash -- 'a long passphrase'`
   (or `echo 'a long passphrase' | npm run admin:hash` to keep it out of the process list; your shell history
   still sees the first form). It prints the `scrypt:...` line, plus a fresh random `ADMIN_SESSION_SECRET`
   suggestion on stderr.
2. Set it on the environment (this restarts the app process, about a minute; players reconnect, ships persist):
   ```
   aws elasticbeanstalk update-environment --region us-east-2 --environment-name PirateTradeWarsEnv \
     --option-settings \
     Namespace=aws:elasticbeanstalk:application:environment,OptionName=ADMIN_PASSWORD_HASH,Value='scrypt:...' \
     Namespace=aws:elasticbeanstalk:application:environment,OptionName=ADMIN_SESSION_SECRET,Value=<64+ hex chars>
   ```
   Changing either value signs everyone out (the session key is HMAC(secret, password hash)).
3. To turn admin off: remove `ADMIN_PASSWORD_HASH` (`aws elasticbeanstalk update-environment ... --options-to-remove Namespace=aws:elasticbeanstalk:application:environment,OptionName=ADMIN_PASSWORD_HASH`).

Agents: confirm with Theo before touching the EB environment.

## Security

- **Password check:** async `crypto.scrypt` (libuv pool, never blocks the 20 Hz tick) and `timingSafeEqual`.
  Passwords over 1 KB are refused without hashing. At most 2 checks run at once (each scrypt holds 16 MB);
  extra tries get `429 busy`.
- **Rate limit (in memory, a restart clears it):** 5 failed tries per IP per 15 minutes, and 30 failed tries in
  total per 15 minutes locks sign-in for everyone (IP rotation can't brute force). Every try is charged before
  the hash is checked (a parallel burst can't slip past), a correct one is refunded. While locked even the right
  password is refused.
- **Client IP:** read from `X-Forwarded-For` ourselves: the entry `ADMIN_TRUSTED_PROXY_HOPS` from the right of
  `[...XFF, socket peer]`. Production is browser -> ALB (appends the client IP) -> nginx (appends the ALB IP) ->
  node, so 2 hops; anything further left is client-supplied and ignored. Express `trust proxy` is NOT set (so
  nothing else in the app changes).
- **Session:** cookie `ptw_admin`, `HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=43200` (12 h), plus
  `Secure` when `NODE_ENV=production`. Value `v1.<expMs>.<nonce>.<hmac>`; the server checks the HMAC (constant
  time), the expiry, and the logout revocation list (in memory).
- **CSRF:** SameSite=Strict, plus every admin POST must be `Content-Type: application/json` (cross-site forms
  can't send that without a CORS preflight, which we never answer) and, when an `Origin` header is present, its
  host must equal `Host`.
- **Headers:** every `/api/admin` response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`;
  unknown `/api/admin/*` paths 404 (they never fall through to the SPA).
- **Logs:** `[admin] login ok|fail|locked|busy ip=…`, `[admin] logout ip=…`,
  `[admin] action <action> [amount=] player=<id> ip=…: <text>`. Never the password. The request logger in
  `server/index.ts` skips the 1 s `GET /api/admin/state` polls and never logs admin or beacon bodies.
- **No secrets in the client bundle:** the page only talks to the API; the hash and secret stay in env vars.

## API

All under `/api/admin`, JSON. Types: `shared/adminApi.ts`.

| Call | Auth | Answer |
|---|---|---|
| `POST /login {password}` | - | 200 `{ok}` + cookie; 401 `{error:"wrong", remaining}`; 429 `{error:"locked", scope:"ip"\|"global", retryAfterSec}` or `{error:"busy"}` |
| `POST /logout {}` | - | 200, clears + revokes the cookie |
| `GET /session` | cookie | 200 `{ok}` / 401 (the page's "am I signed in") |
| `GET /state` | cookie | `AdminStateResponse` (below). The page polls it every second while visible. |
| `POST /action {playerId, action, amount?}` | cookie | 200 `{ok, row, text, warning?, log}`; 400 bad input; 409 refused (captain gone / already a Dreadnaught) |

`GET /state`:
- `captains[]`: every connected, afloat human player (no NPCs, no ships in the 60 s disconnect grace): `id, name,
  shipType, ship` (display name)`, nextShip` (null at Dreadnaught)`, status, where, lat, lon, hp, maxHp, gold,
  cargoUsed, cargoCapacity, source, campaign?, onlineSince`.
  - `status`: `combat` if the ship fired a broadside (`firedAtTick`) or took a hit (`hitAtTick`, set in
    `World.applyHit`) in the last 15 s; else `port` if within the 300 dock radius of a port; else `idle` if no
    non-neutral input (throttle/rudder/fire, `lastActiveWall`, set in `World.queueInput`) for 60 s (a hidden tab
    sends nothing); else `sea`.
  - `where`: the port name when docked, else `Off <nearest port>`. `lat`/`lon` from `shared/world/geo.ts`.
- `npcShips` (NPCs in the world now, i.e. near players), `npcRecords` (whole NPC population), `tickAvgMs`
  (moving average of `runTick`, ~5 s), `tickMaxMs` (longest tick, current/last 60 s window; same numbers the
  `[tick]` log line reports).
- `today`: `{day, timeZone, visits{src:n}, captains{src:n}, newCaptains, socialCaptains, socialBreakdown[],
  totalVisits, socialVisits}`.
- `log`: the last 50 admin actions, newest first (in memory; a restart clears it).

### Actions

Validated by `parseAdminAction`: `playerId` a string of 1..64 chars, not `npc:*`; `action` one of
`repairFull` (hp = maxHp), `repairQuarter` (+25% of max hull, capped), `gold` (`amount` an integer
1..1,000,000), `upgrade` (next ship in `SHIP_UPGRADE_PATH`, free).

How they apply (`live.ts`): on the player's `playerQueue` (the same queue as trade / sellAll / upgrade / repair,
so they never interleave with a player's own port action), synchronously on the live world player (never inside
`World.step`), then `redisStorage.updatePlayerState` like the socket handlers. The upgrade is
`world.setShipType` (the paid upgrade's own path minus the cost): new stats, full hull, gold, cargo and position
kept; `metaVersion` bumps so viewers get a fresh `ent`. The player's client needs no new message: the snapshot
`me` carries hp/maxHp/gold/shipType/cargoCapacity every tick, `useSocket.syncSelf` pushes those changes to the HUD
immediately, and prediction takes the new ship stats from `me.shipType`. (We do NOT send `upgradeSuccess`: the
trade screen would read it as the reply to a refit it never asked for.) Segment gets an `Admin Action` event.

## Where players come from

- **Client** (`client/src/lib/source.ts`, called from `main.tsx` on game pages, never on `/admin`): on the first
  load of a browser session, `utm_source` (or `?ref=`) wins, else `document.referrer` is classified, else
  `Direct`; `utm_campaign` is kept too. Stored in sessionStorage (`ptw_source`); one `POST /api/visit
  {source, campaign?}` beacon per session (`ptw_visit_sent`). The websocket `connect` and `reconnect` messages
  carry `source` / `campaign` (PROTOCOL.md §4).
- **Labels** (`shared/source.ts`): `TikTok`, `YouTube`, `Facebook` (incl. fb, l./lm.facebook.com), `X` (twitter,
  x.com, t.co), `Instagram`, `Reddit` = social; `Search` (Google, Bing, DuckDuckGo, Yahoo, Ecosia, Brave,
  Yandex, Baidu); `Discord`; `Direct`; anything else = its bare lowercase domain / token (max 40 chars of
  `[a-z0-9.-]`). The server re-sanitizes every value (`sanitizeSource`), so the client string is never trusted.
  Tip for posts: link `https://piratetradewars.com/?utm_source=tiktok&utm_campaign=trailer1`; in-app browsers
  often drop the referrer, so the utm tag is the reliable signal.
- **Server:** `connect` stores `source`/`campaign`/`joinedAtWall` on the world player (memory only) and adds
  `source`/`campaign` to Segment "Player Connected". A reconnect keeps a known source (fills a missing one) and
  is not counted. Old clients without a source = `Direct`.
- **Counters (Redis):** `stats:<YYYY-MM-DD>:visits` and `stats:<YYYY-MM-DD>:captains`, hash field = source,
  HINCRBY with a 90-day TTL, day in `ADMIN_TZ`. `POST /api/visit` is limited to 20 per IP per hour (in memory),
  JSON only, and works even while admin is off.
- **Tiles:** Captains online (+ NPC ships); New captains today; From social today (new captains from social, per
  network); Social visitors who played (social new captains / social visits today); Server tick.

## The page

Sign-in (password field, Sign in, wrong-password / tries-left / locked messages) -> dashboard: header with the
live indicator (live / connection lost / paused while hidden) and Sign out; five tiles; the world chart
(`/world/map_1024x512.png`, equirectangular, pins coloured by status, the selected one bigger with a white
ring; pins are buttons with labels); filter chips (All / At sea / In port / In combat / From social); the
captains table (click a name to select); the selected-captain panel (hull, gold, source, online time, cargo,
position; Repair to full, +25% hull, gold +100 / +1,000 / +10,000 and a custom amount, Upgrade to <next>,
disabled at Dreadnaught); results and errors inline (`role=status`); the admin log. Only a custom gold amount
over 100,000 asks for confirmation. Polling pauses while the tab is hidden and refreshes at once when it comes
back. Below 640 px everything stacks (tiles in two columns, the table scrolls sideways).
