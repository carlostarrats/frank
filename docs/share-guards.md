# Share guards: FRANK_SHARE patterns

Frank's URL share deploys your app to Vercel as a preview. Most apps "just
work" — encoders auto-generate safe placeholder env values that pass SDK
init. But some interaction patterns depend on a reachable backend at
runtime, and those patterns degrade badly if you don't guard them.

This page documents the `FRANK_SHARE` convention: `process.env.NEXT_PUBLIC_FRANK_SHARE`
is set to `'1'` when Frank is building your share. Branch on it to skip
probes, swap data, or short-circuit interactions that would otherwise hit a
non-existent placeholder.

**When you need a guard:** when pre-flight smoke returns 🟡 (or you see
obvious broken UI in the share preview). The guard library below covers the
common patterns. Add whichever ones apply to your code.

**Intentional design point:** Frank does not auto-apply guards at v1. You
hand-edit the files yourself, commit when you're ready, and the guard stays
in your working tree for every future share. A codemod-assisted flow is a
v1.1 target once we have real-user data about which patterns are common.

---

## Supabase — session probe

Problem: many apps call `supabase.auth.getSession()` in a `useEffect` on the
login or dashboard page. In share mode the Supabase URL is a placeholder,
the fetch fails, and if the loading state only clears in the success path,
the user sees a stuck spinner forever.

```ts
const IS_FRANK_SHARE = process.env.NEXT_PUBLIC_FRANK_SHARE === '1';

useEffect(() => {
  if (IS_FRANK_SHARE) {
    setCheckingSession(false);
    return;
  }
  supabase.auth.getSession()
    .then(({ data }) => setSession(data.session))
    .finally(() => setCheckingSession(false));
}, []);
```

## Clerk — auth buttons

Problem: `<SignInButton>` and `<SignUpButton>` open Clerk's hosted modal or
redirect to the Clerk frontend API. In share mode the Clerk host is
`placeholder.clerk.accounts.dev` — clicks land on a DNS error page or
silently no-op.

```tsx
import { SignInButton } from '@clerk/nextjs';

const IS_FRANK_SHARE = process.env.NEXT_PUBLIC_FRANK_SHARE === '1';

{IS_FRANK_SHARE ? (
  <button disabled title="Auth disabled in share preview">Sign In</button>
) : (
  <SignInButton />
)}
```

Same pattern for `<SignUpButton>`, `<UserButton>`, `<OrganizationSwitcher>`
— wherever Clerk buttons would hit the hosted host at click time.

## Stripe — SSG-prerender checkout retrieval

Problem: apps that statically prerender a `/result` or `/success` page and
call `stripe.checkout.sessions.retrieve(sessionId)` at build time fail the
build — Stripe rejects the dummy session ID with "Please provide a valid
session_id (`cs_test_...`)".

```tsx
export default async function Result({ searchParams }) {
  if (process.env.NEXT_PUBLIC_FRANK_SHARE === '1') {
    return (
      <div>
        <h1>Checkout complete</h1>
        <p>This result page is a placeholder in the share preview. In production, it shows real order details.</p>
      </div>
    );
  }
  const session = await stripe.checkout.sessions.retrieve(searchParams.session_id);
  // ...render normally
}
```

For per-request Stripe (Server Actions, API routes, `stripe.customers.create`
triggered by a button), no guard is needed — the encoder's dummy key passes
SDK init, and the actual API calls fail at HTTP level which is the correct
degraded behavior.

## Sentry — no guard needed

Sentry's SDK handles missing-reachability silently. The encoder sets
`SENTRY_DSN=https://public@o0.ingest.sentry.io/0` which resolves DNS; the
endpoint returns 401 on ingest; Sentry's client swallows the error. Your app
behaves normally.

## Auth0 — auth trigger buttons

Problem: clicking "Login" calls `/api/auth/login` (or similar) which
redirects to the Auth0 `/authorize` endpoint on the placeholder domain.
Resolves via Auth0's wildcard DNS but 404s on the endpoint.

```tsx
const IS_FRANK_SHARE = process.env.NEXT_PUBLIC_FRANK_SHARE === '1';

{IS_FRANK_SHARE ? (
  <button disabled title="Login disabled in share preview">Login</button>
) : (
  <a href="/api/auth/login">Login</a>
)}
```

## PostHog — no guard needed

Like Sentry, PostHog queues events and fails silently. The encoder points
at the real PostHog host; events POST with a dummy key and return 401,
which `posthog-js` swallows.

---

## Server Actions — any server-side write

Problem: Next.js Server Actions that write to a DB or external service fail
at runtime in share mode because the connected services are placeholders.

```ts
'use server';

export async function submitContactForm(formData: FormData) {
  if (process.env.NEXT_PUBLIC_FRANK_SHARE === '1') {
    return { ok: false, reason: 'Disabled in share preview' };
  }
  // ...real write
}
```

Ditto for any server-side function that writes: email sends, webhook posts,
file uploads to third-party storage, etc.

## Generic `fetch` on mount

Problem: any component that fetches data from your API on mount and doesn't
render anything meaningful until the fetch resolves.

```ts
const IS_FRANK_SHARE = process.env.NEXT_PUBLIC_FRANK_SHARE === '1';

const MOCK_PRODUCTS = [
  { id: 'demo-1', name: 'Sample product', price: '$29' },
  { id: 'demo-2', name: 'Another sample', price: '$49' },
];

useEffect(() => {
  if (IS_FRANK_SHARE) {
    setProducts(MOCK_PRODUCTS);
    setLoading(false);
    return;
  }
  fetch('/api/products')
    .then((r) => r.json())
    .then((data) => setProducts(data))
    .finally(() => setLoading(false));
}, []);
```

This is especially useful for portfolio-style apps where you want reviewers
to see *something* instead of empty states.

---

## What NOT to guard

Don't guard:

- **CSS, layout, routing, animations** — these work natively in share mode.
- **Client-side state** — hooks, reducers, form validation, accordion
  toggles, etc.
- **Read operations to your DB** — they fail silently; UI degrades to empty
  state. Only guard these if the empty state looks broken.
- **Sentry, PostHog, analytics** — they fail silently by design.
- **Third-party embed widgets** (Vimeo, YouTube, etc.) — they work
  cross-origin like normal.

The rule of thumb: guard things that *block the UI* or *redirect to a
broken endpoint when clicked*. Everything else tends to degrade cleanly.

---

## When to stop adding guards

If smoke returns 🟢 after your guard set, you're done. The envelope's
pre-flight (build + 30s log tail) is the practical check — if it's green,
the reviewer experience will match the green signal.

If smoke still returns 🟡 after guarding all the usual patterns, it often
means the app is hitting a non-standard env dependency Frank doesn't yet
recognize. Add the env key to `.env.share` with a plausible dummy value and
re-run smoke.
