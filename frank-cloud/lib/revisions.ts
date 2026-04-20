import { kv } from '@vercel/kv';

// Per-share revision counter. INCR is atomic in Redis, which gives us the
// monotonic guarantee the direction doc requires.
export async function nextRevision(shareId: string): Promise<number> {
  const rev = await kv.incr(`share:${shareId}:revision`);
  return rev as number;
}

export async function peekRevision(shareId: string): Promise<number> {
  const rev = (await kv.get<number>(`share:${shareId}:revision`)) ?? 0;
  return rev;
}

// On revocation: wipe the counter along with everything else for the share.
export async function deleteRevision(shareId: string): Promise<void> {
  await kv.del(`share:${shareId}:revision`);
}
