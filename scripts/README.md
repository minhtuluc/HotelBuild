# Executable documentation checks

This is documentation tooling, not a production application. Use Node 24 (minimum 22.13) and install the locked dependencies with `npm ci`.

| Command | What it actually verifies |
|---|---|
| `npm run check` | All documentation checks, tooling regression tests and embedded database tests |
| `npm run check:docs` | Local links, Mermaid syntax, canonical IDs and every BR's trace row |
| `npm run check:links` | Markdown links/images, including reference links and HTML links: local target existence and Markdown heading/explicit anchors |
| `npm run check:mermaid` | Every Mermaid fence parsed by Mermaid with jsdom; no image rendering or visual layout certification |
| `npm run check:ids` | Concrete BR/FR/UC/NFR references (including numeric ranges) must resolve to exactly one canonical table definition; all BR rows require FR, UC, API, Entity and TC coverage or documented acceptance |
| `npm run test:tooling` | Negative and boundary cases for the extractors, canonical definition detection and anchors |
| `npm run test:db` | Fresh in-memory PGlite, both extensions, §3 DDL, real SQL assertions against constraints and the documented Q1/Q2 queries |
| `npm run test:postgres` | The same assertions against a real PostgreSQL 16 server, plus a two-session contested inventory assignment |
| `npm run --silent extract:sql` | SQL-only stdout, in source order, extracted **only from §3** of the database document |

The link checker ignores remote URLs, mail links and other URI schemes; it does not make network requests. Markdown anchors use GitHub slug rules, including Vietnamese text and duplicate headings. It checks all repository Markdown outside dependency/tool metadata directories. It cannot certify links to future code mentioned as plain text, or the semantics of remote resources.

Canonical IDs come from rule tables in [business rules](../docs/02-nghiep-vu/quy-tac-nghiep-vu.md), definition tables in [functional requirements](../docs/01-yeu-cau/yeu-cau-chuc-nang.md) and [nonfunctional requirements](../docs/01-yeu-cau/yeu-cau-phi-chuc-nang.md), and §8 of the [overview](../docs/00-tong-quan.md). Mentions elsewhere cannot define an ID. Wildcards and schematic placeholders are not concrete IDs. Trace coverage is checked in §2 of the [trace matrix](../docs/06-truy-vet/ma-tran-truy-vet.md). Exemptions must be listed in its §6 table with the column name, BR, a reason, and explicit `Chấp nhận` disposition. A `Cần sửa` disposition fails. Stale accepted exemptions fail too. This is structural trace verification, not proof that a narrative test case or endpoint implements its BR correctly.

## Database execution

PGlite loads `btree_gist` and `pgcrypto` from the package's contrib modules, as described in the [official extension catalog](https://pglite.dev/extensions/). It needs neither Docker nor `psql`. Its embedded PostgreSQL version is printed in the test output and may differ from 16. A PGlite pass does **not** establish PostgreSQL 16 compatibility, multi-session concurrency, production throughput, Redis TTL behavior, HTTP semantics or a running pricing engine.

Set `DATABASE_URL` to a **disposable PostgreSQL 16 cluster** and run `npm run test:postgres`. The runner requires CREATE DATABASE, CREATE ROLE and extension privileges. It verifies the server's major version, creates a uniquely named temporary database, loads the exact extracted DDL, and drops that database in cleanup. It never drops the database named in `DATABASE_URL`. The documented DDL creates cluster roles `app_rw`, `app_ro` and `analytics_ro` if absent; those roles remain until the disposable cluster is discarded. Do not point this command at a production or shared cluster. Missing credentials or a different major version fail; there is no embedded fallback.

The [CI workflow](../.github/workflows/docs-quality.yml) runs separate documentation/embedded and PostgreSQL 16 jobs. The real server job uses a disposable `postgres:16` service and observes the second writer waiting on a lock before committing the first writer, then requires SQLSTATE `23P01` and exactly one surviving assignment. Embedded mode explicitly skips that test because independent sessions are unsupported.

DDL is never copied into a checked-in `.sql` file. The Markdown parser selects §3, takes its SQL fences in order, and stops at the next second-level heading. Repeated examples in §4 and §7 and queries in §9 are excluded from schema execution. Test fixtures are synthetic SQL data, rolled back after each case; Q1/Q2 themselves are read from §9 on each run. Constraint rejection assertions require the expected SQLSTATE, with savepoints keeping each transaction usable.

The database tests cover room/bed exclusion and half-open ranges, one-place-per-booking-room, maintenance conflicts, capacity/allotment limits, same-channel and expiring commitments, partial assignments, partial cancellation, oversold quantities, OTA quota/closure, immutable price/policy snapshots, rate priority, payment signs and scoped deduplication, independent refunds and allocation limits, audit chaining/privileges, webhook leases and optimistic versions. They verify the supplied DDL's behavior; they do not implement missing application workflows or certify every narrative test in the test plan.
