import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Redirect FRANK_DIR so the test's records.json lives in a temp dir and
// never touches the real ~/.frank/.
let tmp: string;

vi.mock('../protocol.js', () => {
  const original = vi.importActual('../protocol.js') as any;
  return {
    ...original,
    get FRANK_DIR() { return tmp; },
  };
});

import {
  writeShareRecord,
  listShareRecords,
  markRecordRevoked,
  purgeExpiredRecords,
  purgeOrphanedShareBuilds,
  removeShareBuild,
  shareRecordsPath,
  type UrlShareRecord,
} from './share-records.js';

function record(overrides: Partial<UrlShareRecord> = {}): UrlShareRecord {
  return {
    shareId: 'share_abc',
    revokeToken: 'tok_abc',
    vercelDeploymentId: 'dpl_abc',
    deploymentUrl: 'https://frank-share-abc.vercel.app',
    shareUrl: 'https://frank-cloud.vercel.app/s/share_abc',
    projectId: 'proj-1',
    createdAt: '2026-04-23T10:00:00.000Z',
    expiresAt: '2026-05-23T10:00:00.000Z',
    projectDir: '/tmp/app',
    ...overrides,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-records-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('share-records — writeShareRecord + listShareRecords', () => {
  it('writes and reads back a single record', () => {
    writeShareRecord(record());
    const list = listShareRecords();
    expect(list).toHaveLength(1);
    expect(list[0].shareId).toBe('share_abc');
  });

  it('file is created with mode 0600', () => {
    writeShareRecord(record());
    const target = shareRecordsPath();
    expect(fs.existsSync(target)).toBe(true);
    const stat = fs.statSync(target);
    // Last 3 digits of mode should be 600 (owner read/write only).
    expect((stat.mode & 0o777).toString(8)).toBe('600');
  });

  it('appends a second record without clobbering the first', () => {
    writeShareRecord(record({ shareId: 'a' }));
    writeShareRecord(record({ shareId: 'b' }));
    const list = listShareRecords();
    expect(list.map((r) => r.shareId).sort()).toEqual(['a', 'b']);
  });

  it('replaces an existing record with the same shareId (idempotent)', () => {
    writeShareRecord(record({ shareId: 'same', deploymentUrl: 'v1' }));
    writeShareRecord(record({ shareId: 'same', deploymentUrl: 'v2' }));
    const list = listShareRecords();
    expect(list).toHaveLength(1);
    expect(list[0].deploymentUrl).toBe('v2');
  });

  it('returns empty list when no file exists', () => {
    expect(listShareRecords()).toEqual([]);
  });

  it('filters by projectId', () => {
    writeShareRecord(record({ shareId: 'a', projectId: 'proj-1' }));
    writeShareRecord(record({ shareId: 'b', projectId: 'proj-2' }));
    writeShareRecord(record({ shareId: 'c', projectId: 'proj-1' }));
    const forProj1 = listShareRecords({ projectId: 'proj-1' });
    expect(forProj1.map((r) => r.shareId).sort()).toEqual(['a', 'c']);
  });

  it('hides revoked records by default', () => {
    writeShareRecord(record({ shareId: 'live' }));
    writeShareRecord(record({ shareId: 'dead', revokedAt: '2026-04-23T11:00:00.000Z' }));
    const visible = listShareRecords();
    expect(visible.map((r) => r.shareId)).toEqual(['live']);
  });

  it('surfaces revoked records when asked', () => {
    writeShareRecord(record({ shareId: 'live' }));
    writeShareRecord(record({ shareId: 'dead', revokedAt: '2026-04-23T11:00:00.000Z' }));
    const all = listShareRecords({ includeRevoked: true });
    expect(all.map((r) => r.shareId).sort()).toEqual(['dead', 'live']);
  });

  it('hides expired records by default', () => {
    writeShareRecord(record({ shareId: 'fresh', expiresAt: '2099-01-01T00:00:00.000Z' }));
    writeShareRecord(record({ shareId: 'stale', expiresAt: '2020-01-01T00:00:00.000Z' }));
    const visible = listShareRecords();
    expect(visible.map((r) => r.shareId)).toEqual(['fresh']);
  });

  it('returns records newest-first', () => {
    writeShareRecord(record({ shareId: 'old', createdAt: '2026-04-20T10:00:00.000Z' }));
    writeShareRecord(record({ shareId: 'new', createdAt: '2026-04-23T10:00:00.000Z' }));
    writeShareRecord(record({ shareId: 'mid', createdAt: '2026-04-22T10:00:00.000Z' }));
    const list = listShareRecords();
    expect(list.map((r) => r.shareId)).toEqual(['new', 'mid', 'old']);
  });
});

describe('share-records — markRecordRevoked', () => {
  it('sets revokedAt + revoke on the matching record', () => {
    writeShareRecord(record({ shareId: 's1' }));
    markRecordRevoked('s1', { linkInvalidated: true, vercelDeleted: true });
    const all = listShareRecords({ includeRevoked: true });
    const r = all.find((x) => x.shareId === 's1')!;
    expect(r.revokedAt).toBeTruthy();
    expect(r.revoke).toEqual({ linkInvalidated: true, vercelDeleted: true });
  });

  it('preserves partial-revoke detail (cloud ok, Vercel failed)', () => {
    writeShareRecord(record({ shareId: 's1' }));
    markRecordRevoked('s1', {
      linkInvalidated: true,
      vercelDeleted: false,
      vercelError: 'Vercel API 500',
    });
    const all = listShareRecords({ includeRevoked: true });
    const r = all.find((x) => x.shareId === 's1')!;
    expect(r.revoke?.vercelDeleted).toBe(false);
    expect(r.revoke?.vercelError).toBe('Vercel API 500');
  });

  it('no-ops on unknown shareId (doesn\'t throw)', () => {
    writeShareRecord(record({ shareId: 'other' }));
    expect(() => markRecordRevoked('missing', { linkInvalidated: true, vercelDeleted: true })).not.toThrow();
    const list = listShareRecords();
    expect(list).toHaveLength(1);
    expect(list[0].shareId).toBe('other');
  });
});

describe('share-records — purgeExpiredRecords', () => {
  it('drops records expired more than retentionDays ago', () => {
    const longAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const recent = new Date(Date.now() - 1 * 86400000).toISOString();
    writeShareRecord(record({ shareId: 'ancient', expiresAt: longAgo }));
    writeShareRecord(record({ shareId: 'recent', expiresAt: recent }));
    const dropped = purgeExpiredRecords(30);
    expect(dropped).toBe(1);
    const remaining = listShareRecords({ includeExpired: true });
    expect(remaining.map((r) => r.shareId)).toEqual(['recent']);
  });

  it('returns 0 when nothing is expired', () => {
    writeShareRecord(record({ expiresAt: '2099-01-01T00:00:00.000Z' }));
    expect(purgeExpiredRecords(30)).toBe(0);
  });

  it('works when file doesn\'t exist yet', () => {
    expect(purgeExpiredRecords(30)).toBe(0);
  });
});

describe('share-records — purgeOrphanedShareBuilds', () => {
  function makeBuildDir(shareId: string): string {
    const dir = path.join(tmp, 'share-builds', shareId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'marker.txt'), shareId);
    return dir;
  }

  it('keeps dirs for live, non-expired records', () => {
    const future = new Date(Date.now() + 86400000 * 7).toISOString();
    writeShareRecord(record({ shareId: 'live', expiresAt: future }));
    makeBuildDir('live');
    const removed = purgeOrphanedShareBuilds();
    expect(removed).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'share-builds', 'live'))).toBe(true);
  });

  it('removes dirs whose record is revoked', () => {
    const future = new Date(Date.now() + 86400000 * 7).toISOString();
    writeShareRecord(record({
      shareId: 'dead',
      expiresAt: future,
      revokedAt: new Date().toISOString(),
    }));
    makeBuildDir('dead');
    const removed = purgeOrphanedShareBuilds();
    expect(removed).toEqual(['dead']);
    expect(fs.existsSync(path.join(tmp, 'share-builds', 'dead'))).toBe(false);
  });

  it('removes dirs whose record has expired', () => {
    writeShareRecord(record({
      shareId: 'stale',
      expiresAt: '2020-01-01T00:00:00.000Z',
    }));
    makeBuildDir('stale');
    const removed = purgeOrphanedShareBuilds();
    expect(removed).toEqual(['stale']);
    expect(fs.existsSync(path.join(tmp, 'share-builds', 'stale'))).toBe(false);
  });

  it('removes orphan dirs with no record at all', () => {
    makeBuildDir('orphan-a');
    makeBuildDir('orphan-b');
    const removed = purgeOrphanedShareBuilds();
    expect(removed.sort()).toEqual(['orphan-a', 'orphan-b']);
    expect(fs.existsSync(path.join(tmp, 'share-builds', 'orphan-a'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'share-builds', 'orphan-b'))).toBe(false);
  });

  it('returns [] when share-builds directory does not exist', () => {
    expect(purgeOrphanedShareBuilds()).toEqual([]);
  });

  it('mixed scenario: one live, one revoked, one orphan', () => {
    const future = new Date(Date.now() + 86400000 * 7).toISOString();
    writeShareRecord(record({ shareId: 'live', expiresAt: future }));
    writeShareRecord(record({
      shareId: 'dead',
      expiresAt: future,
      revokedAt: new Date().toISOString(),
    }));
    makeBuildDir('live');
    makeBuildDir('dead');
    makeBuildDir('orphan');
    const removed = purgeOrphanedShareBuilds();
    expect(removed.sort()).toEqual(['dead', 'orphan']);
    expect(fs.existsSync(path.join(tmp, 'share-builds', 'live'))).toBe(true);
  });
});

describe('share-records — removeShareBuild', () => {
  it('deletes the named directory and returns true', () => {
    const dir = path.join(tmp, 'share-builds', 's1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    expect(removeShareBuild('s1')).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('returns true even when the dir does not exist (no-op)', () => {
    // rmSync with force: true doesn't throw on ENOENT; current impl returns
    // true — accept it as a benign no-op.
    expect(removeShareBuild('missing')).toBe(true);
  });
});
