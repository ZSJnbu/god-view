import assert from 'node:assert/strict';
import { currentProtocolVersion, type GodViewEvent } from '@god-view/protocol';
import { parseExtensionEvent } from '@god-view/webview-bridge';
import type { MapService, MapUpdate } from '../src/engine/map-service.js';
import { routeMapUpdate } from '../src/view/map-update-event.js';
import {
  createService,
  deletePath,
  deliver,
  identity,
  renamePath,
  settle,
  watchUpdates,
  writeFile,
  type UpdateWaiter,
} from './harness.js';

/**
 * 文件变化 → watcher → MapService → 事实更新 的端到端回归。
 *
 * 这条链路上连续出现过四次「单元测试全绿、真实链路不通」的缺陷：增量选择漏掉
 * `node.locations`、校验候选过滤同样漏掉 `node.locations`、覆盖率分母包含已删除
 * 文件、事实更新沿用图版本被判为过期。共同点是只有在真实 Extension Host 里才暴露。
 */

/** 用例会改动的文件及其原始内容，afterEach 负责恢复（writeFile 会自动建父目录）。 */
const fixtureFiles: Readonly<Record<string, string>> = {
  'src/orders/index.ts': "import { pay } from '../payment/index.js';\nexport const order = pay;\n",
  'src/payment/index.ts': 'export const pay = (): void => undefined;\n',
  'src/api/server.ts': 'export const serve = (): void => undefined;\n',
  'src/unclassified.ts': 'export const todo = 1;\n',
};

function seedEvents(workspaceId: string, branchKey: string): readonly GodViewEvent[] {
  const envelope = (eventId: string): Omit<GodViewEvent, 'type' | 'payload'> => ({
    version: currentProtocolVersion,
    workspaceId,
    branchKey,
    sessionId: 'itest',
    eventId,
    timestamp: '2026-08-07T10:00:00.000Z',
    actor: { kind: 'agent', adapterId: 'itest' },
  });

  return [
    {
      ...envelope('itest.orders'),
      type: 'node_upsert',
      payload: {
        node: { id: 'module.orders', type: 'module', label: '订单', paths: ['src/orders'] },
      },
    },
    {
      ...envelope('itest.payment'),
      type: 'node_upsert',
      payload: {
        node: { id: 'module.payment', type: 'module', label: '支付', paths: ['src/payment'] },
      },
    },
    {
      ...envelope('itest.orders-payment'),
      type: 'edge_upsert',
      payload: {
        edge: {
          id: 'edge.orders-payment',
          from: 'module.orders',
          to: 'module.payment',
          type: 'depends_on',
          evidence: [
            { kind: 'explicit_import', location: { path: 'src/orders/index.ts', startLine: 1 } },
          ],
        },
      },
    },
    {
      // 只声明 locations、不声明 paths：增量选择与校验候选过滤都曾经漏掉这种节点。
      ...envelope('itest.api'),
      type: 'node_upsert',
      payload: {
        node: {
          id: 'module.api',
          type: 'entry',
          label: '入口',
          locations: [{ path: 'src/api/server.ts', startLine: 1 }],
        },
      },
    },
  ] as GodViewEvent[];
}

function missingFiles(update: MapUpdate): readonly (string | undefined)[] {
  return update.drift.filter((one) => one.kind === 'missing_file').map((one) => one.targetId);
}

function hasMissingFile(update: MapUpdate): boolean {
  return missingFiles(update).length > 0;
}

function coverageTotal(update: MapUpdate): number {
  return (update.coverage?.classified ?? 0) + (update.coverage?.unclassified ?? 0);
}

let service: MapService;
let waiter: UpdateWaiter;

describe('文件变化驱动的事实刷新', () => {
  before(async function () {
    // 首次启动要等 VS Code 的文件监听就绪，给足时间。
    this.timeout(60000);
    const { id } = identity();
    service = await createService();
    // 先投递再 open：InboxWatcher 启动时会 drain 已堆积的事件。
    await deliver(seedEvents(id, service.capabilities.branchKey));
    await service.open();
    assert.equal(service.snapshot.nodes.size, 3, '种子事件应当被接受，否则后续断言没有意义');
  });

  after(async () => {
    await service.flush();
    service.dispose();
  });

  beforeEach(async () => {
    await settle(service);
    waiter = watchUpdates(service);
  });

  afterEach(async () => {
    waiter.dispose();
    for (const [path, contents] of Object.entries(fixtureFiles)) {
      await writeFile(path, contents);
    }
  });

  it('删除声明目录内的文件会更新覆盖率，且走事实时间线而非图补丁', async () => {
    const beforeFacts = service.factsRevision;
    const beforeTotal = (service.coverage?.classified ?? 0) + (service.coverage?.unclassified ?? 0);

    await deletePath('src/payment/index.ts');
    const update = await waiter.next(
      (one) => one.factsRevision > beforeFacts && one.coverage !== undefined,
      '删除文件后应重算覆盖率',
    );

    // 图没有变，只有事实变了——这正是曾经被当成过期补丁丢弃的那类更新。
    assert.equal(update.kind, 'facts');
    assert.equal(update.patch.upsertedNodes.length, 0);
    assert.equal(update.revision, service.snapshot.revision);
    assert.equal(coverageTotal(update), beforeTotal - 1, '已删除的文件必须退出覆盖率分母');

    // 继续走生产代码与 MapPanel 共用的路由，防止服务算对了、面板却又把事实
    // 包成 map/patch，最终在 Webview 被图 revision 丢弃。
    const delivery = routeMapUpdate(update);
    assert.equal(delivery.kind, 'event');
    const parsed = parseExtensionEvent(delivery.event);
    assert.ok(parsed.ok, 'MapPanel 生成的事实消息必须通过协议解析');
    assert.equal(parsed.value.type, 'map/facts');
    assert.equal(parsed.value.factsRevision, update.factsRevision);
  });

  it('删除目录内单个文件不产生 missing_file，因为声明的目录仍然存在', async () => {
    // L0 校验器只回答「声明引用的路径是否存在」。`module.payment` 声明的是目录
    // `src/payment`，删掉里面一个文件后目录仍在，因此不算漂移——这类变化通过
    // 覆盖率体现。是否应当把「已分类文件消失」也升级为漂移，属于产品语义问题。
    const beforeFacts = service.factsRevision;
    await deletePath('src/payment/index.ts');

    const update = await waiter.next(
      (one) => one.factsRevision > beforeFacts,
      '删除文件后应产生一次事实更新',
    );

    assert.ok(!missingFiles(update).includes('module.payment'));
  });

  it('删除整个声明目录会产生 missing_file', async () => {
    await deletePath('src/payment', true);
    try {
      const update = await waiter.next(hasMissingFile, '删除声明目录后应出现 missing_file');
      assert.ok(missingFiles(update).includes('module.payment'));
    } finally {
      await writeFile('src/payment/index.ts', fixtureFiles['src/payment/index.ts'] ?? '');
    }
  });

  it('恢复目录后旧的漂移结论被清除', async () => {
    await deletePath('src/payment', true);
    await waiter.next(hasMissingFile, '先制造一次漂移');

    await writeFile('src/payment/index.ts', fixtureFiles['src/payment/index.ts'] ?? '');
    const update = await waiter.next((one) => !hasMissingFile(one), '恢复后 missing_file 应当消失');

    assert.equal(missingFiles(update).length, 0);
  });

  it('只通过 locations 引用的文件被删除时同样产生漂移', async () => {
    await deletePath('src/api/server.ts');

    const update = await waiter.next(
      hasMissingFile,
      '删除 locations 引用的文件后应出现 missing_file',
    );

    assert.ok(
      missingFiles(update).includes('module.api'),
      '漂移应当归属到只声明了 locations 的节点',
    );
  });

  it('重命名整个声明目录会产生漂移', async () => {
    await renamePath('src/payment', 'src/payment-renamed');
    try {
      const update = await waiter.next(hasMissingFile, '重命名声明目录后应出现 missing_file');
      assert.ok(missingFiles(update).includes('module.payment'));
    } finally {
      await deletePath('src/payment-renamed', true);
      await writeFile('src/payment/index.ts', fixtureFiles['src/payment/index.ts'] ?? '');
    }
  });

  it('修改显式 import 会产生关系漂移，恢复后当场清除', async () => {
    await writeFile(
      'src/orders/index.ts',
      "import '../shipping/index.js';\nexport const order = 1;\n",
    );
    const drifted = await waiter.next(
      (update) =>
        update.drift.some(
          (finding) =>
            finding.kind === 'conflicting_declaration' &&
            finding.targetId === 'edge.orders-payment',
        ),
      '移除显式 import 后关系应变成 conflicting_declaration',
    );
    assert.ok(
      drifted.drift.some((finding) => finding.targetId === 'edge.orders-payment'),
      'L1 漂移必须归属到关系而不是源节点',
    );

    await writeFile('src/orders/index.ts', fixtureFiles['src/orders/index.ts'] ?? '');
    const restored = await waiter.next(
      (update) =>
        !update.drift.some(
          (finding) =>
            finding.kind === 'conflicting_declaration' &&
            finding.targetId === 'edge.orders-payment',
        ),
      '恢复 import 后旧关系漂移应清除',
    );
    assert.ok(!restored.drift.some((finding) => finding.targetId === 'edge.orders-payment'));
  });

  it('写入 .godview 运行时目录不会触发刷新自激', async () => {
    const before = service.factsRevision;

    await writeFile('.godview/scratch.json', '{}');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    assert.equal(service.factsRevision, before, '.godview 内的写入不应触发事实重算');
  });
});
