# @leeroybrun/codex-mcp-server-resume

Experimental npm distribution for a forked `codex-mcp-server` binary that supports
resuming sessions from rollout JSONL files.

## Usage

Run the MCP server via npx:

```bash
npx -y @leeroybrun/codex-mcp-server-resume --help
```

The launcher selects the appropriate native binary for the current
`process.platform` / `process.arch` and executes it, forwarding all CLI args.

## Package contents

- `bin/codex-mcp-server-resume.js`: Node launcher.
- `vendor/<targetTriple>/codex-mcp-server/codex-mcp-server[.exe]`: native binaries.

