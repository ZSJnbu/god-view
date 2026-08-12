# God View 0.1.0 compatibility fixture

This directory is an immutable storage sample produced by extension `0.1.0` with protocol
`1.0`. Tests must copy it before use and must never rewrite it in place.

- `snapshot.json` is the initial valid snapshot envelope.
- `events.jsonl` is the tail that creates two nodes and one edge.

When a new stable version ships, retain this fixture and add a new versioned directory. A
release is blocked if the current reader cannot restore the previous stable fixture without
quarantine or rejected events.
