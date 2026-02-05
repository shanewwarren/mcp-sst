# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP-SST is an MCP (Model Context Protocol) server that enables Claude and other MCP clients to interact with SST (Serverless Stack) development environments. It provides tools for reading dev logs, monitoring Lambda invocations, and checking deployment status.

Installed directly from GitHub via `npx github:shanewwarren/mcp-sst`.

## Commands

```bash
npm run build     # Compile TypeScript to dist/
npm run dev       # Watch mode compilation
npm start /path   # Run server with SST project path
```

## Architecture

Three main modules:

**src/index.ts** - MCP server entry point
- Sets up stdio transport for MCP communication
- Defines 6 tools: `sst_discover`, `sst_list_tabs`, `sst_read_logs`, `sst_get_status`, `sst_get_invocations`, `sst_get_events`
- Exposes log files as MCP resources via `sst://logs/{stage}/{filename}` URIs
- Routes tool calls to discovery and stream modules

**src/sst-discovery.ts** - SST project detection
- `findSSTConfig()` - Walks up directory tree to find `sst.config.ts`/`sst.config.js`
- `discoverSSTServer()` - Reads `.sst/{stage}.server` files to get server URL and log directory
- `autoDiscover()` - Finds all running SST dev servers in a project
- `getLogFiles()` / `readLogLines()` - Reads from `.sst/log/*.log` files

**src/sst-stream.ts** - SST dev server communication
- `fetchRecentEvents()` - Connects to SST server's `/stream` endpoint (SSE/NDJSON)
- `fetchCompleted()` - Calls `/api/completed` for deployment status
- `extractFunctionInvocations()` - Parses events to reconstruct Lambda invocation history

## SST Integration Points

The server relies on SST's internal file structure:
- `.sst/{stage}.server` - Contains JSON with server URL
- `.sst/log/*.log` - Log files for different components (sst, pulumi, functions)
- SST dev server HTTP endpoints: `/stream` (SSE) and `/api/completed` (REST)

## Distribution

Users install directly from GitHub - no npm registry needed. The `prepare` script in package.json ensures the TypeScript is compiled when installed via `npx github:shanewwarren/mcp-sst`.
