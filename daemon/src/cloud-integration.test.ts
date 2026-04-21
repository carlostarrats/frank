import { describe, it, expect, beforeAll } from 'vitest';

// Opt-in harness: skipped when FRANK_CLOUD_BASE_URL is unset so a normal
// `npm test` run stays fast and offline. Point the env at either `vercel
// dev` (local) or a Vercel preview to exercise the real backend.
//
// See frank-cloud/INTEGRATION_TESTING.md for the full rationale and
// why this suite exists (backstop for contract bugs that daemon unit
// tests can't catch).

const BASE_URL = process.env.FRANK_CLOUD_BASE_URL;
const API_KEY = process.env.FRANK_CLOUD_API_KEY;

const skip = !BASE_URL || !API_KEY;

// Edge functions on `vercel dev` have a cold-start warmup per endpoint
// (~2–4s first hit, <1s once warm). Default Vitest per-test timeout of
// 5s isn't enough for tests that exercise two or three cold endpoints
// in sequence. Bump it to 15s for the whole suite; the SSE test has
// its own explicit longer timeout.
describe.skipIf(skip)('cloud integration', { timeout: 15_000 }, () => {
  beforeAll(() => {
    if (!BASE_URL) throw new Error('FRANK_CLOUD_BASE_URL required');
    if (!API_KEY) throw new Error('FRANK_CLOUD_API_KEY required');
  });

  it('health endpoint returns ok with valid key', async () => {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('creates a static share and fetches it back', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>integration-test</p>' },
        contentType: 'url',
        coverNote: 'integration test',
      }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.shareId).toMatch(/^[a-zA-Z0-9_-]{8,20}$/);
    expect(created.revokeToken).toMatch(/^[a-zA-Z0-9_-]{8,20}$/);

    const fetched = await fetch(`${BASE_URL}/api/share?id=${created.shareId}`);
    expect(fetched.status).toBe(200);
    const body = await fetched.json();
    expect(body.snapshot.html).toContain('integration-test');
  });

  it('second view of a share does not crash (allowOverwrite regression)', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>viewcount</p>' },
        contentType: 'url',
      }),
    });
    const { shareId } = await create.json();

    const first = await fetch(`${BASE_URL}/api/share?id=${shareId}`);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.metadata.viewCount).toBeGreaterThanOrEqual(1);

    const second = await fetch(`${BASE_URL}/api/share?id=${shareId}`);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.metadata.viewCount).toBeGreaterThan(firstBody.metadata.viewCount);
  });

  it('posted comment appears in subsequent fetch', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>comments</p>' },
        contentType: 'url',
      }),
    });
    const { shareId } = await create.json();

    const postRes = await fetch(`${BASE_URL}/api/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shareId,
        author: 'harness',
        text: 'integration test comment',
      }),
    });
    expect(postRes.status).toBe(200);

    const fetched = await fetch(`${BASE_URL}/api/share?id=${shareId}`);
    const body = await fetched.json();
    const match = body.comments.find(
      (c: { author: string; text: string }) =>
        c.author === 'harness' && c.text === 'integration test comment',
    );
    expect(match).toBeDefined();
  });

  it('posted state event is delivered via SSE within timeout', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>live</p>' },
        contentType: 'canvas',
      }),
    });
    const { shareId } = await create.json();

    const post = await fetch(`${BASE_URL}/api/share/${shareId}/state`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'state',
        revision: 1,
        payload: { canvasState: '{}', assets: {} },
      }),
    });
    expect(post.status).toBe(200);

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 15_000);

    const stream = await fetch(`${BASE_URL}/api/share/${shareId}/stream`, {
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);

    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let seenState = false;

    try {
      while (!seenState) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by blank lines. Parse whatever's
        // complete so far; keep any trailing partial in the buffer.
        const rawEvents = buffer.split('\n\n');
        buffer = rawEvents.pop() ?? '';
        for (const raw of rawEvents) {
          const eventLine = raw.split('\n').find((l) => l.startsWith('event:'));
          if (eventLine && eventLine.split(':')[1].trim() === 'state') {
            seenState = true;
            break;
          }
          // Anything else (keep-alives, other event types) — keep reading.
        }
      }
    } finally {
      clearTimeout(abortTimer);
      try {
        controller.abort();
      } catch {
        /* already aborted */
      }
    }

    expect(seenState).toBe(true);
  }, 20_000); // outer timeout > inner 15s abort so failure surfaces as assertion

  // This test currently fails against the cloud: DELETE's cleanup step
  // deletes meta.json along with the rest of the share's blobs, so the
  // GET handler's `if (meta.revoked === true) return 410` branch is
  // unreachable and the response comes back 404 instead. Smoke test
  // doc + Phase 5 direction specify 410. Fix tracked as Phase 6 Task 4
  // blocker; this test stays as-written so the fix is verifiable.
  it('revoked share returns 410 on subsequent fetch', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>revoke</p>' },
        contentType: 'url',
      }),
    });
    const { shareId, revokeToken } = await create.json();

    const del = await fetch(`${BASE_URL}/api/share?id=${shareId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'x-frank-revoke-token': revokeToken,
      },
    });
    expect(del.status).toBe(200);

    const fetched = await fetch(`${BASE_URL}/api/share?id=${shareId}`);
    expect(fetched.status).toBe(410);
    const body = await fetched.json();
    expect(body.error).toBe('revoked');
  });

  it('comment on revoked share returns 410', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>comment-after-revoke</p>' },
        contentType: 'url',
      }),
    });
    const { shareId, revokeToken } = await create.json();

    const del = await fetch(`${BASE_URL}/api/share?id=${shareId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'x-frank-revoke-token': revokeToken,
      },
    });
    expect(del.status).toBe(200);

    const post = await fetch(`${BASE_URL}/api/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shareId,
        author: 'harness',
        text: 'should be rejected',
      }),
    });
    expect(post.status).toBe(410);
    const body = await post.json();
    expect(body.error).toBe('revoked');
  });

  it('ping on nonexistent share returns 404', async () => {
    // Valid-looking but never-created id.
    const res = await fetch(`${BASE_URL}/api/share/nonexistent9X/ping`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('ping on revoked share returns 410', async () => {
    const create = await fetch(`${BASE_URL}/api/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snapshot: { html: '<p>ping-after-revoke</p>' },
        contentType: 'url',
      }),
    });
    const { shareId, revokeToken } = await create.json();

    await fetch(`${BASE_URL}/api/share?id=${shareId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'x-frank-revoke-token': revokeToken,
      },
    });

    const ping = await fetch(`${BASE_URL}/api/share/${shareId}/ping`, {
      method: 'POST',
    });
    expect(ping.status).toBe(410);
  });
});
