import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readTextFile, writeFileAtomic } from '@god-view/storage';

const metadataFileName = 'runtime.json';

interface RuntimeMetadata {
  readonly schemaVersion: 1;
  readonly extensionVersion: string;
  readonly protocolVersion: string;
}

export interface RuntimeAssetState {
  /** 版本无关的稳定路径；Agent 配置在扩展升级后仍然有效。 */
  readonly gatewayEntry: string;
  readonly extensionVersion: string;
  readonly protocolVersion: string;
  readonly upgradedFrom?: string;
}

export interface RuntimeAssetOptions {
  readonly sourceGateway: string;
  readonly globalStorageRoot: string;
  readonly extensionVersion: string;
  readonly protocolVersion: string;
}

/**
 * 把 VSIX 内的 Gateway 发布到版本无关的 globalStorage 路径。
 *
 * VS Code 升级扩展时会删除旧版本安装目录；如果 Agent 配置直接引用 extensionUri，下一次
 * 启动就会变成死路径。这里先完整读取新 bundle，再分别原子替换 runtime 与元数据：源文件
 * 缺失或读取失败时不会碰现有可用版本。元数据完全由版本输入决定，重复运行结果一致。
 */
export async function installRuntimeAssets(
  options: RuntimeAssetOptions,
): Promise<RuntimeAssetState> {
  const runtimeRoot = join(options.globalStorageRoot, 'runtime');
  const gatewayEntry = join(runtimeRoot, 'god-view.mjs');
  const metadataPath = join(runtimeRoot, metadataFileName);
  const previous = parseMetadata(await readTextFile(metadataPath));

  // 先读源文件；失败时不得覆盖当前 runtime 或元数据。
  const bundle = await readFile(options.sourceGateway, 'utf8');
  const metadata: RuntimeMetadata = {
    schemaVersion: 1,
    extensionVersion: options.extensionVersion,
    protocolVersion: options.protocolVersion,
  };
  await writeFileAtomic(gatewayEntry, bundle);
  await writeFileAtomic(metadataPath, JSON.stringify(metadata));

  return {
    gatewayEntry,
    extensionVersion: options.extensionVersion,
    protocolVersion: options.protocolVersion,
    ...(previous !== undefined && previous.extensionVersion !== options.extensionVersion
      ? { upgradedFrom: previous.extensionVersion }
      : {}),
  };
}

function parseMetadata(contents: string | undefined): RuntimeMetadata | undefined {
  if (contents === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return record['schemaVersion'] === 1 &&
    typeof record['extensionVersion'] === 'string' &&
    typeof record['protocolVersion'] === 'string'
    ? {
        schemaVersion: 1,
        extensionVersion: record['extensionVersion'],
        protocolVersion: record['protocolVersion'],
      }
    : undefined;
}
