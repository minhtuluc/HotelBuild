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
`core`, `staff`, `users`, `guest`. A module exports `createHandler(): FakeHandler`
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
