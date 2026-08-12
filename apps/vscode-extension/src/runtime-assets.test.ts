import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installRuntimeAssets } from './runtime-assets.js';

let root: string;
let source: string;
let storage: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'god-view-runtime-'));
  source = join(root, 'source.mjs');
  storage = join(root, 'global-storage');
  await writeFile(source, 'console.log("v1")', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function install(extensionVersion: string) {
  return installRuntimeAssets({
    sourceGateway: source,
    globalStorageRoot: storage,
    extensionVersion,
    protocolVersion: '1.0',
  });
}

describe('installRuntimeAssets', () => {
  it('首次安装到版本无关的稳定路径', async () => {
    const installed = await install('0.1.0');
    expect(installed.gatewayEntry).toBe(join(storage, 'runtime', 'god-view.mjs'));
    expect(await readFile(installed.gatewayEntry, 'utf8')).toBe('console.log("v1")');
    expect(installed.upgradedFrom).toBeUndefined();
  });

  it('升级覆盖同一稳定路径并记录来源版本', async () => {
    const first = await install('0.1.0');
    await writeFile(source, 'console.log("v2")', 'utf8');
    const upgraded = await install('0.2.0');

    expect(upgraded.gatewayEntry).toBe(first.gatewayEntry);
    expect(upgraded.upgradedFrom).toBe('0.1.0');
    expect(await readFile(upgraded.gatewayEntry, 'utf8')).toBe('console.log("v2")');
  });

  it('同版本重复执行幂等，元数据字节不变', async () => {
    await install('0.1.0');
    const metadataPath = join(storage, 'runtime', 'runtime.json');
    const before = await readFile(metadataPath, 'utf8');
    const repeated = await install('0.1.0');
    expect(await readFile(metadataPath, 'utf8')).toBe(before);
    expect(repeated.upgradedFrom).toBeUndefined();
  });

  it('新 bundle 缺失时保留上一版 runtime 与元数据', async () => {
    const installed = await install('0.1.0');
    const metadataPath = join(storage, 'runtime', 'runtime.json');
    const beforeBundle = await readFile(installed.gatewayEntry, 'utf8');
    const beforeMetadata = await readFile(metadataPath, 'utf8');
    await rm(source);

    await expect(install('0.2.0')).rejects.toThrow();
    expect(await readFile(installed.gatewayEntry, 'utf8')).toBe(beforeBundle);
    expect(await readFile(metadataPath, 'utf8')).toBe(beforeMetadata);
  });
});
