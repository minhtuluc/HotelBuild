# Web session BFF (HB-019)

`@pinehill/web-session/server` is server-only. The two Next apps expose POST
`/api/session/login`, `/refresh`, `/logout`; the browser must send
`X-Session-Request: 1`. The BFF verifies the exact request origin, pins OPS_WEB or
GUEST_WEB, and calls the configured backend through ApiClient. Guest logout uses
the published shared `/auth/logout` endpoint.

Set `SESSION_APP_ORIGIN` to the exact public app origin behind a proxy (for example
`https://ops.pinehill.vn`, no trailing slash). The BFF compares Origin with this
trusted configuration, rather than an internal Next URL or a forwarded Host.
Without the override the canonical Request URL is used.

Refresh tokens are host cookies, named `pinehill_staff_refresh` or
`pinehill_guest_refresh`, with HttpOnly, Secure, SameSite=Strict and
Path=/api/session. Secure is omitted only for HTTP 127.0.0.1 in development.
Refresh lifetime comes from the backend. No refresh token is returned in a JSON
body. Refresh is never automatically retried; accepted refresh failures and logout
outcomes clear the cookie. Responses use no-store and sanitized error envelopes.

## Browser integration

```ts
import { ApiClient } from '@pinehill/api-client';
import { createSessionClient } from '@pinehill/web-session/client';

const session = createSessionClient({ kind: 'staff' });
const api = new ApiClient({
  baseUrl,
  getAccessToken: session.getAccessToken,
  onUnauthorized: session.onUnauthorized,
});
await session.login({ username, password });
// Use api for protected requests. Call session.logout() to end the session.
// On component/provider disposal, call session.dispose().
```

Create the client in the browser after mount, and use one client in the app session provider. Access tokens stay in memory;
localStorage contains only a random revision nonce. Web Locks serialize session
operations across same-origin tabs; BroadcastChannel transfers memory state.
Revision checks reject stale messages after logout or another login. The API
client passes the token used by a failed request to onUnauthorized, so a delayed
401 from an older token can reuse a rotation already completed by another tab.

The client refreshes before expiry, emits `session-expired` on refresh failure,
and stops automatic requests after expiry/disposal. HTTPS (or trusted loopback),
Web Locks, BroadcastChannel and localStorage access are required; no unsafe
parallel-refresh fallback is supplied. Authorization and idle policy remain on
the backend. Login screens are delivered by HB-020/HB-023.

## Test API extension

The loopback HTTP fixture at `tests/e2e/fake-api/server.ts` loads modules under
`core`, `staff`, `users`, `guest`, `journey`. A module exports `createHandler(context): FakeHandler`
using `core/types.ts`; return undefined for an unhandled route. Handlers are
consulted in folder/file order. No absent optional folder is required.

Core includes auth, guest auth and health. `/__control/{synthetic-actor-key}`
accepts POST `{ status: 401 | 423 | 429, delayMs?: number }`; GET returns only
status and refresh/logout counters. It never returns tokens. Control requests
from untrusted origins are refused. The test asset `/__test/session-client.js`
bundles the real client for browser verification; the fake server is not a
production service.

`E2E_API_BASE_URL`, `E2E_CUSTOMER_WEB_PORT`, `E2E_OPERATIONS_WEB_PORT` can isolate a
test session. Playwright starts the fake server and both built Next apps. Existing
screen tests keep their unrelated page.route fixtures; session tests exercise
real Next route handlers and server-to-server HTTP.

## Customer journey BFF (HB-079)

Customer web exposes this fixed allowlist under `/api/session/journey`:

| Method | Relative path                            | Session                             |
| ------ | ---------------------------------------- | ----------------------------------- |
| GET    | `/inventory/availability`, `/rate-plans` | Public                              |
| POST   | `/quotes`                                | Public, or the current guest bearer |
| POST   | `/holds`, `/bookings`                    | Guest bearer required               |
| GET    | `/bookings/{id}`                         | Guest bearer required               |
| DELETE | `/holds/{id}?reason=...`                 | Guest bearer required               |

Use the published request/response schemas and API factories. After browser mount:

```ts
import {
  createBookingApi,
  createInventoryApi,
  createQuoteApi,
  createRateApi,
} from '@pinehill/api-client';
import { createJourneyApiClient, createSessionClient } from '@pinehill/web-session/client';

const session = createSessionClient({ kind: 'guest' });
const client = createJourneyApiClient({ baseUrl: location.origin, session });
const inventory = createInventoryApi(client);
const rates = createRateApi(client);
const quotes = createQuoteApi(client);
const bookings = createBookingApi(client);
// Search/rates/quotes work before login. Login before createHold/create.
// Re-quote after login: quoteId belongs to the principal that requested it.
// Render server totals, deposit, expiry, warnings and duplicateSuspected directly.
// Dispose session when the provider unmounts.
```

The chosen AC1 flow requires login before holding or booking; HB-080…HB-083 can
use the existing guest session rather than introducing account creation here.
The refresh cookie alone does not authorize journey requests. The BFF forwards
only the memory access bearer; identity, ownership and permissions stay with the
backend. It never forwards browser cookies or upstream Set-Cookie.

The browser adapter adds `X-Session-Request: 1` and delegates 401 refresh to
SessionClient. Every write needs a UUIDv4 `Idempotency-Key`; ApiClient generates
it once per request and preserves it across retries. For a user-initiated retry
of an uncertain operation, use `client.request` with the published body/response schemas and the original
`idempotencyKey`. Factory convenience methods generate a fresh key for each call.
The BFF preserves the key, makes one upstream attempt, validates both contracts,
limits bodies to 16 KiB, checks the configured exact Origin on writes, sanitizes
errors and sends no-store. Unknown paths/methods do not reach the upstream API.

### Journey HTTP scenarios

The fake server also loads `journey`. Factories receive a per-server
`FakeApiContext`; core auth supplies `authenticateGuest`, so fixture data and
sessions are isolated. A guest login/refresh/logout uses the real session BFF.
Invented, staff, stale and revoked bearers cannot create holds/bookings. Fixtures
provide four `propertyId` scenarios with the synthetic room `synthetic-room`:

| propertyId          | Behaviour                                                      |
| ------------------- | -------------------------------------------------------------- |
| `journey-standard`  | Availability, four plans, quote, hold, booking, get/release    |
| `journey-expired`   | Expired quote; hold/booking returns 410 `E_RATE_QUOTE_EXPIRED` |
| `journey-taken`     | Hold/booking returns 409 `E_INV_ROOM_TAKEN`                    |
| `journey-duplicate` | Booking returns `duplicateSuspected: true`                     |

Use valid published fields (for example WEB/FLEX7 and a positive date interval).
Quotes use a fixed synthetic nightly VND value; these fixtures are not production
pricing, inventory, deposit or authorization implementations. Writes replay the
same fixture response for the same owner/path/key/body and reject changed input
with `E_SYS_IDEMPOTENCY_KEY_REUSED`. Request a new authenticated quote after login.
Native Next and browser tests exercise server-to-server HTTP without route mocks;
the production booking backend is a separate dependency for UI integration.
