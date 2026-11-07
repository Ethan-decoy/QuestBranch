# Windows research interchange fixture

`portable-research-v3.json` is synthetic research exported by the published Windows x64 `0.3.0-dev.4` executable (public source `facbb6df5e155f8c8f0680e7741e1c67bbecb100`). It was generated using `scripts/verify-branching-mcp.mjs`, a fresh profile/database, and the local ACP/MCP fixture; no personal research, real model, account or credential was used.

The format-3 export contains 5 nodes, 4 report versions, 8 messages and 8 runs. macOS/Linux acceptance imports this same Windows-produced data into a fresh database and reopens it, checking original report text, parent/origin/reference relations, record counts and the absence of credential import or automatic execution. Formatting may change without altering JSON values. This is research interchange, not a full profile or native-session migration fixture.
