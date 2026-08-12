# @god-view/validation-core

## 职责

回答一个问题：**Agent 声明与代码证据是否一致。**

本包定义 Validator 端口、结论聚合与漂移检测，并提供文件事实与 TypeScript/JavaScript
显式相对 import 的内置校验器。

## 校验等级

| 等级 | 来源                                   | 本包是否实现                 |
| ---- | -------------------------------------- | ---------------------------- |
| L0   | 文件事实（存在、路径）                 | ✅ `FileFactValidator`       |
| L1   | TypeScript/JavaScript 显式相对依赖语法 | ✅ `ExplicitImportValidator` |
| L2   | Agent 声明                             | 不由 Validator 产生          |
| L3   | 系统推断                               | 不由 Validator 产生          |

UI 必须展示来源与验证状态，L2/L3 不得显示为 L0/L1 事实。

## 公开 API

| 导出                                                   | 用途                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| `Validator` / `ValidationTarget` / `ValidationOutcome` | 校验器端口                                          |
| `WorkspaceProbe`                                       | 工作区只读探针，把文件系统访问收敛到一个可替换端口  |
| `FileFactValidator`                                    | L0 实现：声明引用的路径是否存在                     |
| `ExplicitImportValidator`                              | L1 实现：核对显式声明的 TS/JS 相对 import 关系      |
| `aggregateOutcomes`                                    | 合并同一实体的多个结论                              |
| `detectDrift`                                          | 双向漂移：声明的文件消失 / 仓库中的第一方文件无归属 |

## L1 支持边界

只有关系显式携带 `explicit_import` 证据时才校验，不会把所有 Agent 声明自动升级成代码事实。
当前识别 TypeScript/JavaScript 的静态 import、side-effect import、`export ... from`、
`require('literal')` 和 `import('literal')`，支持相对路径、扩展名省略、目录节点与 `index.*`。

路径别名、包名导入、非字面量动态导入、运行时调用、框架注入和其他语言不会被推断为已验证；
不可读源文件返回 `unsupported`。声明了 `explicit_import` 但在可读源文件中找不到对应关系时，
返回 `conflicting_declaration` 漂移。

## 关键约束

1. **不支持要说不支持。** 没有路径声明的分组节点返回 `unsupported`，不返回空的「验证成功」。
2. **负面结论优先。** 一个校验器报漂移、另一个报通过时，聚合结果是漂移；否则会把不一致掩盖成已验证。
3. **取消不是错误。** 取消返回 `CANCELLED` 错误码，调用方不应按 error 级别记录。
4. **`verified` 的含义有限。** 只表示路径/文件/显式依赖证据成立，不表示业务职责描述正确。
5. **不修改文件。** Validator 只读。

## 依赖方向

`validation-core ──→ protocol`。不依赖 `vscode`、`node:fs` 或 Git；文件访问通过 `WorkspaceProbe` 注入。

## 测试

```bash
npx vitest run packages/validation-core
```
