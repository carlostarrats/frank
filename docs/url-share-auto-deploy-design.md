# URL Share: Auto-Deploy Design

Status: **design**, 2026-04-22 (rev 4, post-calibration). Ready for v1 implementation.

This doc describes how Frank's URL share will ship the user's actual running app — not a snapshot, not a recording, not a tunnel — to a reviewer who opens a share link. The reviewer gets a real interactive instance of the code, deployed automatically to the user's own Vercel account. The user never runs a deploy command.

## 0. What Frank promises the reviewer will see, and what it doesn't

Stated first so the envelope's scope is explicit and every future "but what about X" question has a single reference.

### Works
Pages render. Static routes and dynamic routes. React (or Svelte / Vue / whatever) hydrates. Client state, hover / focus / transition CSS, modals, dropdowns, tabs, drag-and-drop, animation, charts, fonts, custom CSS. Client-side navigation between compiled routes. Form validation. Anything in the UI layer that doesn't depend on live server data behaves normally.

### Degrades gracefully
- **Auth on page load**: dummy credentials pass SDK init (per §3). Reviewer sees the UI shell — login pages, dashboards, whatever the app renders before a user clicks anything.
- **DB reads**: return empty/null. UI shows empty states.
- **External APIs**: fail silently or return stubbed empty responses.
- **Server Actions**: receive stubbed "not available in share" responses.
- **Auth interactions** (e.g., clicking "Sign In"): the click triggers an SDK fetch to a non-existent placeholder host and the reviewer sees whatever error the SDK surfaces — usually a browser-level DNS error or a silent-no-op, depending on the SDK. At v1 the recommended fix is a documented manual guard (§5); codemod-assisted guards are v1.1.
- **If the user's frank-cloud is offline** (bandwidth paused, token rotated, project deleted): the deployed app **still renders** — its code is self-contained on its own Vercel deployment. The comment **overlay shell renders** too, because `overlay.js` is bundled into the deployment itself (§4.2), not loaded cross-origin. What stops working: the overlay's connection to frank-cloud to fetch/post comments. The UI should show an "unable to load comments — your frank-cloud may be offline" state rather than silently pretending comments are current.

### Does not work
- Writes to external services (DB, Stripe charges, email sends).
- Real user authentication — reviewer is always in the logged-out / share state.
- Cron jobs, webhooks received from external services.
- Server-side operations that require real credentials.
- Streaming responses that depend on external services staying reachable.
- **Monorepos.** Turborepo, pnpm workspaces, Nx, Lerna, npm workspaces — refused at v1. Most modern team setups are monorepos, so this is a real limitation (not an edge case) and stated up front. See §1.3 for the workaround and §10 for v1.5 plans.

### Out of scope
- Desktop / mobile native apps.
- Non-web frameworks.
- Apps that require specific local filesystem access to run.
- Real-time co-viewing / cursor sharing (canvas live-share covers the canvas case; URL share is async review of a live deployed instance, not "watch me click").
- Multi-tenant Vercel accounts with complex team permissions (v1 uses the user's personal Vercel token).

This section is the envelope's contract. Scope questions reference it before re-litigating product scope.

---

## 1. The envelope — what gets accepted for Share

### 1.1 Allowlist bundler (P0)

Frank's bundler uploads only files matching an **explicit allowlist**. Everything else is refused, hardcoded, no configurable override. This rule exists because a denylist fails open — a forgotten `.env.staging` ships real credentials to a public Vercel URL. The cost of "fail open" is too high; the cost of "fail closed" is at worst the user hits a clear refusal and adds an allowlist entry.

**Allowed:**
- Framework source directories per detected framework: `app/`, `pages/`, `src/`, `components/`, `lib/`, `hooks/`, `contexts/`, `utils/`, `styles/` (Next.js); equivalent per-framework lists for Vite / SvelteKit / Astro / Remix.
- `package.json`
- Exactly one lockfile: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock`.
- `public/`
- Known config files: `next.config.*`, `vite.config.*`, `svelte.config.*`, `astro.config.*`, `remix.config.*`, `tsconfig.json`, `postcss.config.*`, `tailwind.config.*`, `eslint.config.*`, `components.json`.
- Middleware / proxy / instrumentation at project root: `middleware.*`, `proxy.*`, `instrumentation.*`, `instrumentation-client.*`, `sentry.*.config.*`.
- `.env.share` — exactly one file, no variants.

**Refused, even on explicit user request:**
- `.env`, `.env.local`, `.env.production`, `.env.staging`, `.env.development`, any `.env.*` except `.env.share`.
- `.git/`, `node_modules/`, `.next/`, `.turbo/`, `dist/`, `build/`, `out/`.
- `test-results/`, `playwright-report/`, `coverage/`, `.vercel/`.
- Files matching `*.pem`, `*.key`, `*.p12`, `*.jks`, `id_rsa*`, `*.crt` (that aren't inside `public/`).
- Any single file over 50 MB.

If the user asks Frank to ship a real `.env.local`, Frank refuses with a specific message:

> Refused by design. Real env files leak secrets to the share URL. Move the needed values to `.env.share` — Frank will help you generate safe defaults.

### 1.2 Framework allowlist

Detected from `package.json` dependencies:
- Next.js 14 / 15 / 16 (App Router + Pages Router)
- Vite + React
- Vite + Svelte
- Vite + Vue
- SvelteKit
- Astro
- Remix

Anything else: refused, not attempted. Clean message: "Frank doesn't support `<framework>` for URL share yet."

### 1.3 Structural rules

Checked from `package.json` and disk at Share time:
- Single package (no workspace protocols in deps, no monorepo root markers: `pnpm-workspace.yaml`, `lerna.json`, Turborepo root, `workspaces` field in `package.json`).
- `engines.node` present and overlaps Vercel's supported range (20.x, 22.x).
- `build` script present in `scripts`.
- All deps resolvable from public npm (no `git+ssh://`, no `file:`, no private registries declared in `.npmrc`).
- Source directories total under 100 MB excluding `node_modules`.

**Monorepo workaround at v1:** point Frank at an individual package directory (e.g., `packages/shop/`) that has its own `package.json`, doesn't use `workspace:*` deps, and builds standalone. Most monorepo packages don't meet this criterion because they depend on local `packages/ui`, `packages/config`, etc. via workspace protocols, so this workaround is narrow. See §10 for v1.5 plans to handle workspace resolution.

Violations → specific actionable refusal. ("Frank can't share monorepo roots yet. Point Frank at the individual package at `packages/shop/` — but note it may fail if it depends on workspace packages.")

### 1.4 Refuse-to-guess rule (P0)

For each third-party SDK detected in `package.json`, one of these must be true:
1. Frank's dummy-value registry has an **encoder validated against the installed version**, OR
2. The user has supplied values for the SDK's env keys in `.env.share`.

If neither: **Share is refused.** Message:

> `@weirdco/sdk` detected in package.json. Frank doesn't yet have a validated encoder for this SDK, and `.env.share` doesn't define its env vars. Options:
> a) Add values to `.env.share` manually (we'll warn if runtime breaks).
> b) Wait for Frank to ship an encoder for this SDK.

No silent dummies. The failure mode "Frank claimed support and the prototype 500s in production" is strictly worse than "Frank refused and told me exactly what to do." This is an explicit envelope rule because claiming coverage that hasn't been earned is how users lose trust.

### 1.5 Architecture: where what runs

Frank's URL-share infrastructure spans **three deployment targets, all on the user's own Vercel account**:

1. **The user's existing frank-cloud deployment.** Long-lived. One per user. This is the backend described in `CLOUD_API.md` + `frank-cloud/README.md`. Stores share records in Vercel Blob / Upstash Redis, serves the share-link endpoints, serves the cloud viewer for canvas shares, and — new for URL share — **serves `overlay.js`** (referenced in §4) and **stores the `revoked` flag** (referenced in §7). Existing Vercel token.

2. **Per-share ephemeral user-app deployments.** Created on each Share click. One Vercel project per share. Source is the user's allowlisted app code (§1.1) with the overlay script injected (§4) and `FRANK_SHARE=1` baked in (§5). Deployed via the Vercel Deployments API (§6). Deleted on revoke (§7). Same Vercel token as (1), so the token scope is `deployments:write + deployments:delete` plus whatever frank-cloud storage access already required.

3. **Frank the local daemon** (`localhost:42068`). Orchestrates the Share flow, runs pre-flight (§2), packages the bundle (§1.1), calls the Vercel API (§6), writes the share record to (1), and communicates status back to the Frank UI.

**Implication for users:** one Vercel token does double duty. It's deploying the user's auto-share projects AND has operational access to frank-cloud. That's a single trust boundary, not two. Users who want hard isolation between "my app" and "Frank's share plumbing" would need two separate Vercel accounts — out of scope for v1 and probably not worth the complexity.

**Implication for `overlay.js` distribution — bundled, not loaded cross-origin:** `overlay.js` is **bundled into each per-share deployment**, served same-origin from the deployed app itself at a stable path like `/frank-overlay.js`. The injected `<script>` tag points at that local path. The overlay then makes cross-origin fetch/SSE calls to frank-cloud for live comment state.

Why bundled, not cross-origin script load: if frank-cloud ever goes offline (bandwidth paused, account suspended, project deleted, domain rotated), a cross-origin `<script src="https://frank-cloud.../overlay.js">` fails silently — the reviewer loads the preview, the app renders, and there's no indication the overlay was supposed to exist. Bundling the script means the overlay shell always renders. Connection failure to frank-cloud for comment state degrades visibly ("comments unavailable") rather than silently.

Cost: `overlay.js` is ~30 KB bundled into every deployment. Cheap. And: if Frank ships an overlay update, existing shares keep their shipped version until re-deployed — stable on their baseline, upgrade when re-sharing.

---

## 2. Pre-flight build + smoke validation

Runs locally on the user's machine before any byte goes to Vercel. This is the most important cost-cutter in the design: bad-env crashes surface in Frank's UI instead of as cryptic Vercel deployment failures.

### 2.1 Build step
- `npm run build` / `pnpm build` / `yarn build` / `bun build` with Frank's generated env loaded from the registry + `.env.share` overrides + `NEXT_PUBLIC_FRANK_SHARE=1`.
- Build failure → surface the exact stderr in Frank's UI. Abort Share.

### 2.2 Smoke step

This is the new protocol step that patches the "build + curl passes but SDK fails async in background" blind spot identified during the Clerk calibration. Covers cases like:
- Sentry's DSN DNS-resolves but fails silently, spamming error logs 50/sec in production.
- Analytics SDKs pinging ingestion endpoints that fail after init.
- OIDC / OAuth providers doing issuer-URL discovery after init.

Protocol:
1. `next start` (or framework equivalent) on an ephemeral port.
2. `curl /` with `--location` (follow redirects up to 2 hops). Many real apps redirect `/` → `/login` or `/` → `/dashboard` — the redirect target is what we actually want to probe. Record both the final URL and HTTP status.
3. Parse the HTML body of the landed page, extract same-origin `<a href>` values, and sample **2 more routes from that link set** (deterministic: first two in document order, excluding `#anchor`, `javascript:`, `mailto:`). If fewer than 2 same-origin links are found, fall back to the first 2 routes from the build-time route manifest, sorted alphabetically. Deterministic, never random — reproducible "worked yesterday, failed today" means something.
4. Curl each of those 2 routes, record status.
5. **Keep the server running for 30 seconds after the last curl.** Tail stderr.
6. Grep stderr for: `ECONNREFUSED`, `ENOTFOUND`, `getaddrinfo`, `fetch failed`, `Invalid key`, `not valid`, `Error:` lines.
7. Count occurrences.

Why this route-selection logic: auth-gated apps 307 all routes to `/login`, so "3 random routes from the manifest" produces three redirects, a green smoke, and no actual meaningful-page validation. Starting at `/` with redirect-follow lands on whatever the app's real entry is; crawling from there reaches routes that are actually reachable from the entry — which is what reviewers will also see.

**Expected edge case (not a bug):** SPA-heavy apps that render their navigation via JavaScript after hydration will have few or zero same-origin `<a>` links in the initial HTML. The fallback-to-manifest path will trigger often for such apps. That's intentional — the fallback is deterministic (alphabetical first 2) and still exercises real routes. If smoke behavior looks off later for SPA-style apps, this is why; don't chase it as a phantom bug.

### 2.3 Readiness signal surfaced to user

Green / yellow / red thresholds below are **calibrated heuristics, expect to tune once we have data from real users**. The shape of the signal matters more than the specific numbers; a healthy app with genuine async noise should not be classified as broken.

- 🟢 **Green** — build passed, smoke clean, <5 `Error:` mentions in 30s. Proceed.
- 🟡 **Yellow** — build passed, smoke returned 200s, but ~5–50 async error lines detected (probably SDK degrading gracefully). Show warning count + stderr samples, let user proceed or edit `.env.share`.
- 🔴 **Red** — build failed, server crashed, or the error-line count is dramatically high (>50 in 30s) indicating a tight retry loop. Block Share. Link to docs.

The thresholds will move. What stays constant: build failure and server crash are always 🔴; clean logs are always 🟢. The 🟡 zone is where calibration data changes things.

---

## 3. Dummy-value registry

### 3.1 Shape — per-SDK encoder modules, not static config

Each registry entry is a tiny code module (5–20 lines) that emits valid-shape dummy values. Code, not JSON, because some SDKs (Clerk being the canonical case) decode their credentials and reject naive strings.

```ts
// daemon/src/share/sdk-encoders/clerk.ts
import type { Encoder } from './types';

export const clerkEncoder: Encoder = {
  packageName: '@clerk/nextjs',
  validatedVersions: '^7.0.0',  // semver range Frank's tested against
  envKeys: ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'],
  generate() {
    const host = 'placeholder.clerk.accounts.dev$';
    const encoded = Buffer.from(host).toString('base64').replace(/=+$/, '');
    return {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${encoded}`,
      CLERK_SECRET_KEY: `sk_test_${'0'.repeat(40)}`,
    };
  },
};
```

### 3.2 Launch scope — honest, with encoder-vs-guard breakdown

The "encoder alone sufficient?" question is per-SDK and needs its own column, because the user burden in §5 hinges on it. An encoder that's enough for render means the user touches zero files. An encoder that needs a guard to avoid a broken interaction means the user touches one file — by hand at v1, via a codemod at v1.1 (§10).

| SDK | Status | Encoder sufficient for render? | Guard required for what? | Test evidence |
|---|---|---|---|---|
| `@supabase/supabase-js` / `@supabase/ssr` | ✅ **Validated 2026-04-22** | **Yes.** Module-scope `createClient` + middleware-scope `createServerClient` both accept placeholder URL + JWT-shaped anon key without throwing. `/login` and `/shop/*` rendered at 200 in AdaptiveShop test. | **Optional.** Apps whose login page blocks the UI on a client-side `supabase.auth.getSession()` probe may hang on the spinner in share mode. Guard = skip that one call when `FRANK_SHARE=1`. Apps without that pattern don't need the guard. | AdaptiveShop full-stack stress run. |
| `@clerk/nextjs` | ✅ **Validated 2026-04-22 (render only)** | **Yes.** Shape-encoded publishable key (base64 of `placeholder.clerk.accounts.dev$`) cleared init. `<ClerkProvider>`, `<SignInButton>`, `<UserButton>` rendered normally. | **Recommended for polish, not required for render.** Clicking `<SignInButton>` triggers an SDK fetch to the placeholder host → browser DNS error page or silent failure depending on SDK version. Guard = render Clerk auth buttons in a "disabled in share mode" state. | Clerk quickstart render stress run. Click-interaction probe **deferred** (sandbox blocked Playwright script; scope for user-permitted re-run). |
| `stripe` / `@stripe/stripe-js` | ✅ **Validated 2026-04-22** | **Yes.** `sk_test_` / `pk_test_` / `whsec_` each + 32 zeros passes SDK init. Compile passed in 772ms on the Stripe-only stress test; full-stack rendering passed in AdaptiveShop. | **Required for SSG-prerender checkout retrieval.** Apps that statically prerender a `/result`-style page calling `stripe.checkout.sessions.retrieve(dummy_id)` 🔴 the build (not an init problem — a real-API-call-at-build-time problem). Guard = short-circuit that specific retrieval when `FRANK_SHARE=1`. Apps that only call Stripe per-request (Server Actions, API routes) don't need the guard. | Vercel `with-stripe-typescript` example compiled cleanly; SSG failed on Stripe API call with dummy session_id. AdaptiveShop's per-request pattern cleared. |
| `@sentry/nextjs` | ✅ **Validated 2026-04-22** | **Yes.** DSN `https://public@o0.ingest.sentry.io/0` passes init. Events fail silently, SDK swallows 401s, 0 log-noise in 30s tail. | **None needed.** Sentry is a well-behaved citizen. | Fresh Next.js 16 + `@sentry/nextjs` + `instrumentation.ts`. Build + start + smoke + 30s tail green. |
| `@auth0/nextjs-auth0` v4 | ✅ **Validated 2026-04-22 (render only)** | **Yes.** `Auth0Client` construction is lazy — no OIDC discovery at init. Placeholder domain + placeholder credentials + 72-char `AUTH0_SECRET` all pass. Middleware runs, `/` → 200, 0 errors in 30s tail. | **Recommended for polish, similar to Clerk.** Clicking login redirects to Auth0's authorize endpoint on the placeholder domain → 404 from Auth0's wildcard. Guard = disable login button when `FRANK_SHARE=1`. | Fresh Next.js 16 + `@auth0/nextjs-auth0@4.18.0`. Click-interaction probe **deferred** (same sandbox block as Clerk). |
| `posthog-js` | ✅ **Validated 2026-04-22** | **Yes.** Opaque key + real host (`https://us.i.posthog.com`) — SDK is lazy and tolerant, events queue silently. | **None needed.** | Fresh Next.js 16 + `posthog-js` + `<PostHogProvider>`. Build + start + smoke + 30s tail green. |

**Do not claim coverage for ⏳ rows until the full validation protocol in §2.2 (plus Appendix A's click-interaction probe where relevant) has passed them.** Each non-interactive run takes ~10 minutes; interactive probing takes longer (see §9 timings). Overclaiming is the exact trust failure this section exists to prevent.

Unknown SDKs detected in a user's `package.json` fall to the refuse-to-guess rule (§1.4).

### 3.3 User override — escape hatch

If `.env.share` supplies a value for any env key an encoder would otherwise generate, Frank uses the user's value. The encoder is skipped for that key. Advanced users who hit a stale encoder or a custom SDK configuration unblock themselves without waiting on a Frank release.

### 3.4 Version-check guard

Pre-flight reads the installed SDK version from `package-lock.json` / `pnpm-lock.yaml`. If the installed version is outside the encoder's `validatedVersions` range, Frank warns at Share time:

> Frank's Clerk encoder was validated against `@clerk/nextjs ^7.0.0`. You have `8.0.1` installed. The generated dummy may no longer work in this version. Options:
> a) Proceed anyway (we'll show you any runtime errors).
> b) Supply a known-working value in `.env.share` manually.
> c) Downgrade `@clerk/nextjs` to match the validated range.

Cheap to implement, prevents the worst support pattern ("it worked last week"). Frank takes responsibility for the encoder; it should not pretend a stale encoder is fine.

---

## 4. Overlay injection (injection-path 'a')

Frank's comment overlay must be same-origin with the deployed app so pins can anchor to DOM elements. Re-proxying the Vercel URL through frank-cloud runs straight back into the SPA-dynamic-chunk problem this whole redesign is trying to solve. Cross-origin iframe with coordinate-only comments degrades the product to a sticky-note tool. The only path that preserves the product is: **inject the overlay script into the app's root layout at Share time.**

### 4.1 Mechanics

Frank detects the framework's root layout file with framework-specific rules. **The goal is to inject into the outermost layout that contains `<html>` and `<body>` — or the nearest equivalent per framework — exactly once.** Injecting into a wrong layout (a nested route-group layout, or a pass-through wrapper) either double-loads the overlay or fails to cover all rendered pages.

**Next.js App Router.** Modern Next apps routinely split layouts across route groups (`app/(marketing)/layout.tsx`, `app/(app)/layout.tsx`, etc.). Next.js enforces that `<html>` and `<body>` live exclusively in the root `app/layout.tsx`. Frank parses the TSX / JSX AST of `app/layout.tsx` and verifies it contains `<html>` and `<body>` tags. If yes, inject there. If the root `app/layout.tsx` is a bare pass-through (no `<html>`/`<body>`, just renders `{children}`) — which is non-conformant to Next's own rules — Share is refused with a diagnostic: "your root layout does not contain `<html>` and `<body>`; Frank can't locate the correct injection site."

**Next.js Pages Router.** `<html>` and `<body>` live in `pages/_document.tsx` (via `<Head>` and `<Html>`), not `pages/_app.tsx`. Frank injects into `_document.tsx` if present. If missing, Frank **refuses the Share** with a clear message: "Your project is missing `pages/_document.tsx`. Add one (see Next.js docs) and try again." Adding a file is the one source transform beyond single-line injection that v1 might otherwise do — and rather than quietly taking that exception, v1's rule is "if the injection site doesn't already exist, the user creates it." Keeps §4's transparency promise narrow and honest: *Frank adds exactly one `<script>` line to a file that already exists, and does nothing else to your source.*

**Middleware file naming.** Next.js 14/15 uses `middleware.ts`; Next.js 16 renamed it to `proxy.ts` (and the exported function name changes from `middleware` to `proxy`). The calibration sweep hit both forms across different starters. Frank's middleware-file detection should accept either name, matching the framework version in the user's `package.json`.

**SvelteKit.** Inject into `src/app.html` (the HTML template, contains `<body>` directly). `src/routes/+layout.svelte` wraps content but isn't the HTML root.

**Astro.** Find the `.astro` file under `src/layouts/` that contains `<html>` and `<body>`. If multiple, pick the one referenced by the most page components (`<Layout>` slot). Refuse on ambiguity.

**Remix.** `app/root.tsx` — Remix mandates `<html>`/`<body>` here.

- Injection emits exactly one `<script>` tag, same-origin to the deployed app:
  ```html
  <script src="/frank-overlay.js" data-share-id="<share-id>" async></script>
  ```
- Frank also copies a `frank-overlay.js` file into the deployment's `public/` directory so the script resolves at `/frank-overlay.js`.
- **Injection happens on a copy** of the source in Frank's share-build working directory — the user's working tree is never modified.
- If the layout file can't be located *and contain `<html>`/`<body>`*: Share is refused. The refusal message names exactly which file Frank looked at and what it expected.

### 4.2 What `overlay.js` does

- Reads `data-share-id` from its own tag.
- Connects to frank-cloud (WebSocket or SSE) for live comment state. Cross-origin fetch/SSE against `https://<user-frank-cloud>.vercel.app/api/share/:id/stream` and friends — frank-cloud already has the CORS config for this from the canvas live-share work.
- Renders pins via **shadow DOM** — app CSS doesn't affect overlay styling, overlay CSS doesn't leak into app.
- Commenting UX is the same triple-anchor scheme (CSS selector + DOM path + coords) used in Frank's existing viewer. Pins persist across page transitions because the overlay script remounts on each framework navigation.
- **Degraded state:** if the connection to frank-cloud fails or is unreachable, the overlay shell still renders, and shows a small banner: "Comments unavailable — frank-cloud may be offline." Reviewer sees the app, sees the banner, doesn't see ghost-not-working pins.

### 4.3 Injection transparency

UI shows before Share proceeds:
> Frank will add one `<script>` tag to your `app/layout.tsx` for the duration of this share. Your working tree is not modified.
> [Show diff] [Proceed]

User can inspect the exact line being added. No surprise mutations.

---

## 5. `FRANK_SHARE` convention + manual guards (v1)

This section replaces an earlier "codemod-applied guards" framing that was load-bearing in rev 2. That framing required a production-quality AST parser + pattern-detection engine + transformation + diff generation per framework — weeks of work that would have blocked the whole auto-deploy loop on speculation about how often guards are actually needed.

**v1 ships encoder-only + documented manual guards.** v1.1 adds codemod-assisted automation, scoped and prioritized by real 🟡 frequency data from v1 users. See §10.

The v1 model:

1. **Encoder runs first.** Generates dummy env (§3). For most SDKs this is enough for render (§3.2 "Encoder sufficient for render?" column). AdaptiveShop's stress test landed 🟢 on encoders alone — no guards, no edits.
2. **Smoke catches what encoder alone can't.** The log-tail protocol (§2.2) flags SDKs that degrade noisily or hang.
3. **Manual guards are documented but never automated at v1.** If smoke returns 🟡, Frank surfaces the specific pattern it detected and links to a copy-pasteable guard. User decides whether to hand-add the guard, accept the degradation, or revise `.env.share`. Frank does not modify source files at v1 — only the `<script>` injection in §4 touches the copy, and that's mechanical (single line, one known location).

### 5.1 The `FRANK_SHARE` env flag

Frank always sets `NEXT_PUBLIC_FRANK_SHARE=1` in the deployed app's env. User code can read this to short-circuit any flow that would hit dummy credentials. This is the contract v1's manual guards rely on and v1.1's codemods will target.

### 5.2 Encoder-first path (zero user edits)

Default flow for any Share where §3.2 says "encoder sufficient for render":
1. Frank generates env from registry + `.env.share` overrides.
2. Pre-flight build + smoke. If both pass 🟢, ship. User never touches code.

Most apps that are mostly content + static UI (landing pages, marketing, dashboards-as-shell) go down this path. This is the "it just works" experience — and it's the entirety of what v1 commits to.

### 5.3 Documented manual guards (when smoke returns 🟡)

When smoke flags 🟡 with recognizable patterns (Supabase session probe hanging, fetch-on-mount without error handling, etc.), Frank's UI shows:

> Smoke test returned 5 async errors. Most likely cause: your login page awaits `supabase.auth.getSession()` in a `useEffect` and blocks UI on it.
>
> Suggested fix — add this guard to `app/login/page.tsx` manually:
> ```ts
> if (process.env.NEXT_PUBLIC_FRANK_SHARE === '1') {
>   setCheckingSession(false);
>   return;
> }
> ```
> [Copy guard] [Show docs] [Proceed with degradation anyway]

Choices at v1:
- **Copy guard** → user pastes it in their editor, saves, re-runs Share. The guard is now in their working tree (their choice).
- **Proceed with degradation** → Frank ships the 🟡 build. Reviewer sees whatever the degradation looks like.
- **Show docs** → link to the docs page with every guard pattern Frank recognizes.

### 5.4 Shipped guard library (v1)

Documented in Frank's share docs, copy-pasteable:

**Supabase session probe:**
```ts
const IS_FRANK_SHARE = process.env.NEXT_PUBLIC_FRANK_SHARE === '1';
useEffect(() => {
  if (IS_FRANK_SHARE) { setCheckingSession(false); return; }
  supabase.auth.getSession().then(...).finally(() => setCheckingSession(false));
}, []);
```

**Clerk auth buttons (disabled in share):**
```tsx
{process.env.NEXT_PUBLIC_FRANK_SHARE === '1' ? (
  <button disabled title="Disabled in share preview">Sign In</button>
) : (
  <SignInButton />
)}
```

**Generic fetch-on-mount:**
```ts
const data = process.env.NEXT_PUBLIC_FRANK_SHARE === '1'
  ? MOCK_DATA
  : await fetchFromDB();
```

**Server Actions:**
```ts
if (process.env.NEXT_PUBLIC_FRANK_SHARE === '1') {
  return { ok: false, reason: 'Disabled in share preview' };
}
```

**Stripe checkout retrieval in SSG / prerender:**
Calibration sweep surfaced this as a real failure mode. Apps that statically prerender a `/result` page calling `stripe.checkout.sessions.retrieve(session_id)` at build time with a dummy ID fail the build. Guard:
```tsx
export default async function Result({ searchParams }) {
  if (process.env.NEXT_PUBLIC_FRANK_SHARE === '1') {
    return <div>Checkout result unavailable in share preview</div>;
  }
  const session = await stripe.checkout.sessions.retrieve(searchParams.session_id);
  // ...render normally
}
```

Ships with v1. Users who apply these manually work. Users who don't see the degraded behavior — which is the honest contract from §0.

---

## 6. Vercel Deployments API integration

### 6.1 One-time setup

- User creates a Vercel personal access token from their Vercel account settings.
- Enters it in Frank Settings → Share Deploy Config.
- Stored encrypted in `~/.frank/config.json` (mode 0600, same pattern as existing cloud config).

**Honest disclosure about token scope.** Vercel's personal access tokens are not fine-grained-permission-scoped the way GitHub's newer PATs are. At token creation time, Vercel offers a scope selector for "Full Account" or a specific team — that's an *account*-scope choice, not a *permission*-scope choice. Whichever scope you pick, the resulting token can do anything your user (or the team) can do: deploy, delete, read env vars, manage domains, manage billing.

Frank only uses deploy + delete operations against this token. Frank cannot cryptographically prevent the token from being misused if it leaks. The setup UI must be explicit:

> This token will have full access to whichever Vercel scope you choose (your account, or a specific team). Vercel doesn't offer narrower permissions at this time. Frank uses only deploy + delete operations. We recommend creating a token scoped to a dedicated team if you want isolation from your main Vercel projects.

If Vercel ships fine-grained PAT scopes in the future, Frank will recommend them — updating both the UI copy and the docs. Don't promise a scope the platform doesn't enforce.

This is the same token that already has access to frank-cloud's storage backend (§1.5). One trust boundary.

### 6.2 Deploy flow

1. Pre-flight passes (§2).
2. Bundler gathers allowlisted files (§1.1).
3. Overlay injection applied to the copy (§4.1). At v1, no other source transforms — manual guards (§5.3) live in the user's working tree if they chose to add them.
4. Frank POSTs `https://api.vercel.com/v13/deployments` with:
   - Bundle as multipart.
   - `env` = encoder outputs + `.env.share` overrides + `NEXT_PUBLIC_FRANK_SHARE=1`.
   - `target: "preview"` (never production).
   - `projectSettings.framework` autodetected.
5. Poll `GET /v13/deployments/:id` every 2 seconds until `readyState: "READY"`, or timeout after 5 minutes.
6. On READY: returns `https://<deployment-id>.vercel.app`.
7. Share record written to frank-cloud with deployment ID, URL, expiry, revoke token.

### 6.3 Build-pending UX — three time states

Typical Vercel preview build for a Next.js app is 30–90 seconds. Some are longer. The UI must cover all three zones:

- **0–90s ("expected range")** → "Building your preview… ~N seconds" with a progress estimate.
- **90s–5min ("taking longer than usual")** → "This build is taking longer than average. Vercel might be busy, or your app is larger than typical. Still running." Cancel button prominent.
- **>5min ("timeout")** → "Build timed out. Vercel may be degraded, or your app may have an infinite loop in its build. Check the full build log." Link to Vercel dashboard.

Build log streamed from Vercel's `/events` endpoint into Frank's UI in all zones. Cancellable at any time — `DELETE` the in-flight deployment, clear the pending share record.

---

## 7. Revoke contract

Full section, not a footnote. The privacy story in the README hinges on this. If revoke is unreliable, "your data stays on your machine" becomes a lie.

### 7.1 Two-state model

Every active share tracks:
- **Frank-cloud state** (stored on the user's own frank-cloud — see §1.5): `{ shareId, vercelDeploymentId, revoked: boolean, auditLog: Event[] }`
- **Vercel state**: the auto-deployed ephemeral project exists or doesn't, independent.

The share link's reachability is gated on **frank-cloud's `revoked` flag**, not on Vercel's state.

### 7.2 Revoke flow

1. **Sync step (instant):** User hits Revoke → frank-cloud flips `revoked: true` on the share record. All requests to `<frank-cloud>/share/<shareId>` return 404 within milliseconds. Reviewers with only the share link lose access immediately.
2. **Async step:** frank-cloud enqueues `DELETE /v13/deployments/:id` on a background job.
3. **Retry with exponential backoff:** If Vercel API returns 5xx or times out, retry with backoff up to 24 hours. Maximum attempt count logged.
4. **Audit log:** Every event written with timestamp to the share record:
   - `revoke_requested`
   - `cloud_flag_flipped`
   - `vercel_delete_attempted`
   - `vercel_delete_succeeded` / `vercel_delete_failed`
5. **User-visible state in Frank UI:**
   - ✅ **Revoked** — cloud flag flipped AND Vercel confirmed deleted.
   - ⏳ **Revoked, Vercel cleanup pending** — cloud flag flipped, Vercel delete in retry queue.
   - ⚠️ **Revoked from share link, but Vercel deployment still live. Retry cleanup?** — after 24h of retries failing. User can manually trigger or ignore.

### 7.3 Why cloud-flag gating, not Vercel-state gating

- Vercel deletes are async; some take seconds, some take minutes under load.
- Vercel API has occasional outages lasting hours.
- During that window the deployment is still publicly reachable at its raw `<id>.vercel.app` URL.
- Frank-cloud cannot prevent someone hitting the raw Vercel URL if they already had it, but it CAN prevent the **share link** from serving the overlay + comment state. Reviewers who only have the share link get 404 instantly — that's the real privacy promise.

### 7.4 Share-time disclosure of the raw-URL caveat — REQUIRED

The unhappy-path reality from §7.3 has to be surfaced **at Share time**, not only on the help page someone looks up after revoke already failed.

In the Share confirmation dialog, below the expiry selector:

> **About revoke:** the share link stops working within a second of hitting Revoke. The underlying Vercel URL takes longer to delete — typically under a minute, up to 24 hours if Vercel's API is degraded. Someone who saved the raw Vercel URL before revoke could still reach it until cleanup completes.

This is also visible in the share detail view after creation, so it's one click away if the user revisits later. Privacy-sensitive users see the caveat before they Share, not after they're surprised.

### 7.5 Auto-revoke triggers

- Expiry reached (default 7 days, user-configurable at Share time: 1d / 1w / 1mo / 1y / custom, matching the canvas-share dropdown already in place).
- User permanently deletes the project in Frank.
- Manual revoke via the share list UI.

All three enter the same flow.

---

## 8. Supported SDK roadmap

### 8.1 Supported at v1 launch (validated 2026-04-22)
- `@supabase/supabase-js` / `@supabase/ssr` ✅ (encoder-only; manual guard optional per §5.4)
- `@clerk/nextjs` ✅ (render-validated; click-interaction probe pending; manual guard recommended per §5.4)
- `stripe` / `@stripe/stripe-js` ✅ (encoder validated; SSG-prerender guard required per §5.4 for apps that call Stripe at build time)
- `@sentry/nextjs` ✅ (encoder-only; no guard needed)
- `@auth0/nextjs-auth0` v4 ✅ (render-validated; click-interaction probe pending; manual guard recommended per §5.4)
- `posthog-js` ✅ (encoder-only; no guard needed)

### 8.2 Click-interaction probes still pending
- Clerk and Auth0 render cleanly but their click-triggered auth flows redirect to placeholder hosts that 404. Whether the SDK surfaces this gracefully or breaks the UI needs a Playwright-driven probe to confirm. Documented as known-degraded in §5.4 guards; full validation pending.

### 8.3 Unknown SDKs

Any SDK detected in the user's `package.json` that isn't in the registry falls to §1.4 refuse-to-guess. Frank shows:

> `<package-name>` detected. Frank doesn't yet have a validated encoder. Supply values in `.env.share` manually, or wait for Frank to add support.

No attempts to guess. No silent dummies. No overclaiming.

---

## 9. Implementation order (v1)

Scoped for the smallest real-app-working v1 — envelope + encoder + overlay + deploy + revoke. No codemod infrastructure. Encoder-only path is proven by AdaptiveShop's stress test; that's enough to ship.

1. **Calibration sweep** (prerequisite to step 4). Run §2.2's validation protocol on Stripe, Sentry, Auth0, PostHog. Add Clerk's click-interaction probe with Playwright. Output: each SDK classified 🟢 / 🟡 / 🔴 with encoder-shape data. **Realistic budget: 1.5–2.5 hours.** Playwright scaffolding alone (install, wire up against a fresh Clerk app, write the click-probe pattern, iterate on flaky selectors) is ~45 min if not already set up. Four more SDKs at ~10–15 minutes each including writing the encoder shape as the stress test runs. Any single 🔴 result is not a v1 blocker — it's a documented "not supported at v1, refused via §1.4." Don't let one stall the sweep.
2. **Envelope detection + allowlist bundler + refusal UI.** Framework detection, structural rule checks, file allowlist, refuse-to-guess on unknown SDKs. Validate on AdaptiveShop + a fresh Vite/React app.
3. **Pre-flight build + deterministic smoke.** Node child-process orchestration, ephemeral-port server spin-up, `/ → crawl → 2 more` smoke protocol, 30s stderr log tail, green/yellow/red readiness UI.
4. **Dummy-value registry.** Encoder module type, registry lookup, Supabase + Clerk encoders at minimum, plus whichever ones passed step 1's sweep. Version-check guard. User override from `.env.share`.
5. **Overlay bundle + injection.** `frank-overlay.js` packaging (same-origin bundling into `public/`), per-framework layout detection (verified to contain `<html>`/`<body>`), injection diff preview UI. Includes overlay's degraded-connection state.
6. **Vercel Deployments API client.** Token storage, deploy call, build polling, URL return, build-log streaming, three-zone build UX.
7. **frank-cloud: share record schema.** `revoked` flag, Vercel metadata, audit log. Extends the existing share-record shape in `CLOUD_API.md`.
8. **Revoke contract.** Sync flag flip, async Vercel delete with retry queue, user-visible state UI, Share-time privacy disclosure.
9. **Docs + guard library.** §5.4's documented manual guards published in Frank's share docs, linked from the 🟡 smoke UI.

Each step ships with the stress-test that validates it before the next begins. Codemod infrastructure is explicitly **not** in v1; see §10.

## 9a. Implementation order (v1.1)

Driven by real-user data from v1. Priority is whichever shape-of-problem the logs show most frequently.

- **Codemod + pattern detection framework.** AST parser per framework (TypeScript/JavaScript for Next/Vite/Remix, Svelte, Astro). Pattern matcher for "find a `useEffect` that awaits `supabase.auth.getSession()` and sets a loading flag." Diff generator preserving formatting. Diff-review UI. Write applied copy back to the share build without modifying the working tree. One seed codemod (Supabase session probe) to prove the framework; others grow with real data.
- **Additional encoders** for SDKs that hit 🟡 frequently at v1.
- **Click-interaction probes** for SDKs with interactive auth flows (Clerk, Auth0, etc.) — Playwright-driven, part of Appendix A.
- **Monorepo support.** Turborepo / pnpm workspaces — detect subpackages, resolve `workspace:*` deps from lockfile, ship flattened bundle.

---

## 10. Open questions deferred past v1

- **Codemod framework — v1.1 target.** See §9a. Significant scope (AST per framework, pattern detection engine, transformation, diff review). Intentionally deferred until real-user 🟡 data justifies the specific patterns to automate. v1 ships with documented manual guards (§5.4) as the fallback.
- **Monorepo support — v1.1 or v1.5 target.** Turborepo / pnpm workspaces are common enough that "not supported" is a real limitation, not an edge case. Path forward: detect subpackages, resolve `workspace:*` deps to their current versions from the lockfile, ship a flattened bundle. Requires per-workspace-manager logic (pnpm, Yarn, npm workspaces, Turborepo, Nx all slightly different).
- **Private npm registries.** v1 refuses. Could be supported with per-project `.npmrc` forwarding.
- **Edge runtime routes with Node builtins.** Framework-level concern; Vercel's builder will reject, Frank surfaces the error.
- **Custom auth schemes that don't fit the `FRANK_SHARE` guard pattern.** Case-by-case; document as "works if you guard your auth probes."
- **Build-time env vars baked into client bundles.** `NEXT_PUBLIC_*` is fine; base-URL-sensitive vars may need a Share-time override pattern in `.env.share`.
- **Hard isolation between user's app deployments and frank-cloud.** §1.5 uses one Vercel token. Users who want two-account isolation aren't supported at v1.

---

## Appendix A: Validation protocol (used for every SDK before being claimed supported)

1. Clone the SDK's canonical Next.js / Vite / SvelteKit starter (or generate a minimal test app).
2. Install deps fresh.
3. Write `.env.local` with dummy values from the proposed encoder.
4. `npm run build` — must exit 0.
5. `npm run start` on an ephemeral port.
6. Run the smoke protocol from §2.2: `curl /` with redirect-follow, parse response, curl 2 more same-origin links (deterministic, document order), fall back to first 2 routes from the manifest alphabetically if no links found.
7. Leave server running for 30 seconds after last curl.
8. Tail stderr, count `ECONNREFUSED` / `ENOTFOUND` / `getaddrinfo` / `fetch failed` / `Error:` occurrences.
9. Classify per §2.3's thresholds (calibrated heuristic: <5 = 🟢, ~5–50 = 🟡, dramatically higher = 🔴).
10. **For SDKs with interactive auth flows (Clerk, Auth0, etc.): additional click-interaction probe.** Drive a headless browser (Playwright) against the running app, click the primary auth-trigger button, observe whether the SDK surfaces an error cleanly or breaks the UI. Mark "render validated" if render passes but click-interaction fails; mark "fully validated" only after both.

Evidence for each validated SDK lives in `~/.claude/projects/.../memory/project_frank_<sdk>_stress_test.md`.
