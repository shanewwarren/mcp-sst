#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  autoDiscover,
  discoverSSTServer,
  findSSTConfig,
  getLogFiles,
  readLastLines,
  readLogLines,
  type SSTProject,
} from "./sst-discovery.js";

import {
  fetchCompleted,
  fetchRecentEvents,
  isServerRunning,
  extractFunctionInvocations,
  groupEventsByType,
} from "./sst-stream.js";

import * as path from "path";

const workingDir = process.argv[2] || process.cwd();

const server = new Server(
  { name: "mcp-sst", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

function getCurrentProject(): SSTProject | null {
  const projects = autoDiscover(workingDir);
  return projects[0] || null;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sst_discover",
      description: "Discover running SST dev servers and available stages.",
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Directory to search (defaults to cwd)" },
        },
      },
    },
    {
      name: "sst_list_tabs",
      description: "List all available log tabs/files from SST dev.",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", description: "Stage name (optional)" },
        },
      },
    },
    {
      name: "sst_read_logs",
      description: "Read the last N lines from a specific SST dev log tab.",
      inputSchema: {
        type: "object",
        properties: {
          tab: { type: "string", description: "Tab name (e.g., 'sst', 'ui-function', 'pulumi')" },
          lines: { type: "number", description: "Number of lines (default: 50)" },
          offset: { type: "number", description: "Offset for pagination (default: 0)" },
        },
        required: ["tab"],
      },
    },
    {
      name: "sst_get_status",
      description: "Get current deployment status and resources from SST dev.",
      inputSchema: {
        type: "object",
        properties: { stage: { type: "string", description: "Stage name" } },
      },
    },
    {
      name: "sst_get_invocations",
      description: "Get recent Lambda function invocations from SST dev.",
      inputSchema: {
        type: "object",
        properties: {
          timeoutMs: { type: "number", description: "Listen time in ms (default: 1000)" },
        },
      },
    },
    {
      name: "sst_get_events",
      description: "Get recent events from the SST dev event stream.",
      inputSchema: {
        type: "object",
        properties: {
          timeoutMs: { type: "number", description: "Listen time in ms (default: 1000)" },
          eventType: { type: "string", description: "Filter to specific event type" },
        },
      },
    },
  ],
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const project = getCurrentProject();
  if (!project) return { resources: [] };
  const logFiles = getLogFiles(project);
  return {
    resources: logFiles.map((file) => ({
      uri: `sst://logs/${project.stage}/${file.name}`,
      name: `${file.name} (${project.stage})`,
      description: `SST dev log: ${file.name}`,
      mimeType: "text/plain",
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^sst:\/\/logs\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid URI: ${uri}`);
  const [, stage, name] = match;
  const configPath = findSSTConfig(workingDir);
  if (!configPath) throw new Error("No SST project found");
  const projectRoot = path.dirname(configPath);
  const project = discoverSSTServer(projectRoot, stage);
  if (!project) throw new Error(`No SST dev server for stage: ${stage}`);
  const logPath = path.join(project.logDir, `${name}.log`);
  const lines = readLastLines(logPath, 500);
  return { contents: [{ uri, mimeType: "text/plain", text: lines.join("\n") }] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "sst_discover": {
      const dir = (args?.directory as string) || workingDir;
      const projects = autoDiscover(dir);
      if (projects.length === 0) {
        const configPath = findSSTConfig(dir);
        if (configPath) {
          return { content: [{ type: "text", text: JSON.stringify({ found: false, message: "SST project found but no dev servers running.", projectRoot: path.dirname(configPath) }, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ found: false, message: "No SST project found" }, null, 2) }] };
      }
      const projectsInfo = await Promise.all(projects.map(async (p) => ({ ...p, running: await isServerRunning(p), logFiles: getLogFiles(p).map((f) => f.name) })));
      return { content: [{ type: "text", text: JSON.stringify({ found: true, projects: projectsInfo }, null, 2) }] };
    }

    case "sst_list_tabs": {
      const project = getCurrentProject();
      if (!project) return { content: [{ type: "text", text: "No running SST dev server found." }] };
      const logFiles = getLogFiles(project);
      const running = await isServerRunning(project);
      return { content: [{ type: "text", text: JSON.stringify({ stage: project.stage, serverUrl: project.serverUrl, serverRunning: running, tabs: logFiles.map((f) => ({ name: f.name, size: `${(f.size / 1024).toFixed(1)} KB`, lastModified: f.modifiedAt.toISOString() })) }, null, 2) }] };
    }

    case "sst_read_logs": {
      const tab = args?.tab as string;
      const lines = (args?.lines as number) || 50;
      const offset = (args?.offset as number) || 0;
      if (!tab) return { content: [{ type: "text", text: "Error: 'tab' parameter required." }] };
      const project = getCurrentProject();
      if (!project) return { content: [{ type: "text", text: "No running SST dev server found." }] };
      const logPath = path.join(project.logDir, `${tab}.log`);
      const result = readLogLines(logPath, offset, lines);
      return { content: [{ type: "text", text: JSON.stringify({ tab, stage: project.stage, total: result.total, showing: result.lines.length, offset, hasMore: result.hasMore, lines: result.lines }, null, 2) }] };
    }

    case "sst_get_status": {
      const project = getCurrentProject();
      if (!project) return { content: [{ type: "text", text: "No running SST dev server found." }] };
      const running = await isServerRunning(project);
      if (!running) return { content: [{ type: "text", text: `SST dev server for '${project.stage}' not responding.` }] };
      const completed = await fetchCompleted(project);
      if (!completed) return { content: [{ type: "text", text: "No deployment data yet." }] };
      return { content: [{ type: "text", text: JSON.stringify({ stage: project.stage, app: completed.App, finished: completed.Finished, errors: completed.Errors, outputs: completed.Outputs, hints: completed.Hints, resourceCount: completed.Resources?.length || 0, resources: completed.Resources?.slice(0, 20).map((r) => ({ type: r.Type, urn: r.URN })) }, null, 2) }] };
    }

    case "sst_get_invocations": {
      const timeoutMs = (args?.timeoutMs as number) || 1000;
      const project = getCurrentProject();
      if (!project) return { content: [{ type: "text", text: "No running SST dev server found." }] };
      const running = await isServerRunning(project);
      if (!running) return { content: [{ type: "text", text: `SST dev server for '${project.stage}' not responding.` }] };
      const events = await fetchRecentEvents(project, timeoutMs);
      const invocations = extractFunctionInvocations(events);
      return { content: [{ type: "text", text: JSON.stringify({ stage: project.stage, collectionTimeMs: timeoutMs, invocationCount: invocations.length, invocations: invocations.map((inv) => ({ functionId: inv.functionId, requestId: inv.requestId, hasOutput: !!inv.output, hasError: !!inv.error, logCount: inv.logs.length, logs: inv.logs.slice(0, 10), error: inv.error })) }, null, 2) }] };
    }

    case "sst_get_events": {
      const timeoutMs = (args?.timeoutMs as number) || 1000;
      const eventType = args?.eventType as string | undefined;
      const project = getCurrentProject();
      if (!project) return { content: [{ type: "text", text: "No running SST dev server found." }] };
      const running = await isServerRunning(project);
      if (!running) return { content: [{ type: "text", text: `SST dev server for '${project.stage}' not responding.` }] };
      const events = await fetchRecentEvents(project, timeoutMs);
      let filteredEvents = eventType ? events.filter((e) => e.type === eventType) : events;
      const grouped = groupEventsByType(filteredEvents);
      return { content: [{ type: "text", text: JSON.stringify({ stage: project.stage, collectionTimeMs: timeoutMs, totalEvents: filteredEvents.length, eventTypes: Object.keys(grouped), eventsByType: Object.fromEntries(Object.entries(grouped).map(([type, evts]) => [type, { count: evts.length, recent: evts.slice(-5) }])) }, null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP-SST server started");
  console.error(`Working directory: ${workingDir}`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
