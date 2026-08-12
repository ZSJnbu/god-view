# Performance evidence

Recorded on 2026-08-12 on the local macOS development machine with Node.js 22+.
The deterministic benchmark runs five projection-and-layout samples per size and gates the P95.

| Dataset                                          | Product budget |          Recorded test duration | Result |
| ------------------------------------------------ | -------------: | ------------------------------: | ------ |
| 5,000 nodes with a 4,999-edge chain              |      P95 ≤ 3 s |  89 ms for the five-sample test | Pass   |
| 10,000 semantic entities with a 9,999-edge chain |      P95 ≤ 5 s | 187 ms for the five-sample test | Pass   |

Run with:

```bash
pnpm exec vitest run apps/webview/src/performance-budget.test.ts --reporter verbose
```

This measures pure full-graph projection and deterministic layout, not Cytoscape DOM/canvas paint,
VS Code IPC, file inventory, or Extension Host cold start. Those remain separate release evidence;
the figures must not be presented as end-user first-paint latency.
