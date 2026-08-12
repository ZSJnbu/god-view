import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commandIds, configKeys, configSection, viewIds } from './constants.js';

/**
 * manifest **声明一致性**测试。
 *
 * 能挡住的：manifest 与 `constants.ts` 两边对不上——比如加了设置却没在代码里声明，
 * 或者声明了却忘了暴露给用户。
 *
 * **挡不住的**：新增一个「假开关」。只要它同时出现在 manifest 和 `configKeys` 里，
 * 这里就会通过——被移除的那三个设置当年正是如此。判断设置是否真的生效，只能靠
 * 针对该设置的行为测试。下面的「不再暴露未实现的开关」是针对已知三项的回归测试，
 * 不具备通用性。
 */

interface Manifest {
  readonly capabilities: {
    readonly untrustedWorkspaces: { readonly supported: boolean };
    readonly virtualWorkspaces: { readonly supported: boolean };
  };
  readonly contributes: {
    readonly commands: { readonly command: string }[];
    readonly views: Record<string, { readonly id: string }[]>;
    readonly configuration: { readonly properties: Record<string, unknown> };
  };
}

async function readManifest(): Promise<Manifest> {
  const here = dirname(fileURLToPath(import.meta.url));
  const contents = await readFile(join(here, '..', 'package.json'), 'utf8');
  return JSON.parse(contents) as Manifest;
}

describe('命令', () => {
  it('manifest 与常量双向一致', async () => {
    const manifest = await readManifest();
    const declared = manifest.contributes.commands.map((entry) => entry.command).sort();

    expect(declared).toEqual(Object.values(commandIds).sort());
  });
});

describe('视图', () => {
  it('manifest 与常量双向一致', async () => {
    const manifest = await readManifest();
    const declared = Object.values(manifest.contributes.views)
      .flat()
      .map((entry) => entry.id)
      .sort();

    expect(declared).toEqual(Object.values(viewIds).sort());
  });
});

describe('设置', () => {
  it('manifest 里的每个设置都在代码常量中声明', async () => {
    const manifest = await readManifest();
    const declared = Object.keys(manifest.contributes.configuration.properties).sort();
    const expected = Object.values(configKeys)
      .map((key) => `${configSection}.${key}`)
      .sort();

    // 多出来的是假开关，少掉的是读了却没暴露给用户的隐藏配置，两者都不允许。
    expect(declared).toEqual(expected);
  });

  it('不再暴露未实现的开关', async () => {
    const manifest = await readManifest();
    const declared = Object.keys(manifest.contributes.configuration.properties);

    for (const removed of ['maxFileSizeKb', 'saveHistory', 'telemetry']) {
      expect(declared).not.toContain(`${configSection}.${removed}`);
    }
  });
});

describe('工作区信任边界', () => {
  it('不受信任与虚拟工作区由 VS Code 在激活前禁用', async () => {
    const manifest = await readManifest();
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(manifest.capabilities.virtualWorkspaces.supported).toBe(false);
  });
});
