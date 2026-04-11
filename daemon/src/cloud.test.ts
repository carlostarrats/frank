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

import { saveCloudConfig, isCloudConnected, getCloudUrl } from './cloud.js';

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
