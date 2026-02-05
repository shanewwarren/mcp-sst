# MCP-SST

MCP server for streaming SST dev logs and controlling the SST dev process.

## Quick Start

Add to Claude Code:

```bash
claude mcp add sst -- npx github:shanewwarren/mcp-sst /path/to/your/sst/project
```

## Alternative: Manual Configuration

Add to `~/.claude/mcp.json` (or `.claude/mcp.json` in your project):

```json
{
  "mcpServers": {
    "sst": {
      "command": "npx",
      "args": [
        "github:shanewwarren/mcp-sst",
        "/path/to/your/sst/project"
      ]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `sst_list_tabs` | List available log tabs |
| `sst_read_logs` | Read last N lines from a log tab |
| `sst_get_status` | Get deployment status |
| `sst_get_invocations` | Get Lambda invocations |
| `sst_get_events` | Get event stream |
| `sst_start` | Start SST dev |
| `sst_stop` | Stop SST dev |
| `sst_restart` | Restart SST dev |
| `sst_process_status` | Get process status |

## Development

```bash
git clone https://github.com/shanewwarren/mcp-sst.git
cd mcp-sst
npm install
npm run build
npm start /path/to/sst/project
```

## License

MIT
