import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
let configPath: string;

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return path.join(tmpDir, 'projects'); },
    get FRANK_DIR() { return tmpDir; },
    get CONFIG_PATH() { return configPath; },
  };
});

import { saveCloudConfig, isCloudConnected, getCloudUrl, getCloudConfiguredAt } from './cloud.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-cloud-'));
  configPath = path.join(tmpDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isCloudConnected', () => {
  it('returns false when no config exists', () => {
    expect(isCloudConnected()).toBe(false);
  });

  it('returns true after saving cloud config', () => {
    saveCloudConfig('https://my-cloud.vercel.app', 'secret-key');
    expect(isCloudConnected()).toBe(true);
  });

  it('returns false when config has missing fields', () => {
    fs.writeFileSync(configPath, JSON.stringify({ cloudUrl: 'https://x.com' }), 'utf8');
    expect(isCloudConnected()).toBe(false);
  });
});

describe('saveCloudConfig', () => {
  it('creates config file with cloudUrl and apiKey', () => {
    saveCloudConfig('https://cloud.example.com', 'my-key');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.cloudUrl).toBe('https://cloud.example.com');
    expect(config.apiKey).toBe('my-key');
  });

  it('preserves existing config fields', () => {
    fs.writeFileSync(configPath, JSON.stringify({ existingField: 'keep' }), 'utf8');
    saveCloudConfig('https://cloud.example.com', 'my-key');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.existingField).toBe('keep');
    expect(config.cloudUrl).toBe('https://cloud.example.com');
  });

  it('overwrites previous cloud config', () => {
    saveCloudConfig('https://old.com', 'old-key');
    saveCloudConfig('https://new.com', 'new-key');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.cloudUrl).toBe('https://new.com');
    expect(config.apiKey).toBe('new-key');
  });
});

describe('getCloudUrl', () => {
  it('returns null when not connected', () => {
    expect(getCloudUrl()).toBeNull();
  });

  it('returns the cloud URL after configuration', () => {
    saveCloudConfig('https://cloud.example.com', 'key');
    expect(getCloudUrl()).toBe('https://cloud.example.com');
  });
});

describe('getCloudConfiguredAt', () => {
  it('returns null when not configured', () => {
    expect(getCloudConfiguredAt()).toBeNull();
  });

  it('returns an ISO timestamp after saving cloud config', () => {
    const before = Date.now();
    saveCloudConfig('https://cloud.example.com', 'key');
    const iso = getCloudConfiguredAt();
    expect(iso).not.toBeNull();
    const ts = Date.parse(iso as string);
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('updates the timestamp when config is re-saved', async () => {
    saveCloudConfig('https://a.com', 'k1');
    const first = getCloudConfiguredAt() as string;
    await new Promise((r) => setTimeout(r, 10));
    saveCloudConfig('https://b.com', 'k2');
    const second = getCloudConfiguredAt() as string;
    expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
  });
});
