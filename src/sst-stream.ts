import type { SSTProject } from "./sst-discovery.js";

export interface SSTEvent {
  type: string;
  event: Record<string, unknown>;
}

export interface FunctionInvokedEvent {
  FunctionID: string;
  WorkerID: string;
  RequestID: string;
  Input: string;
}

export interface FunctionLogEvent {
  FunctionID: string;
  WorkerID: string;
  RequestID: string;
  Line: string;
}

export interface FunctionResponseEvent {
  FunctionID: string;
  WorkerID: string;
  RequestID: string;
  Output: string;
}

export interface FunctionErrorEvent {
  FunctionID: string;
  WorkerID: string;
  RequestID: string;
  ErrorType: string;
  ErrorMessage: string;
  Trace: string[];
}

export interface CompleteEvent {
  App: string;
  Stage: string;
  Finished: boolean;
  Errors: Array<{ URN: string; Message: string }>;
  Outputs: Record<string, unknown>;
  Hints: Record<string, string>;
  Resources: Array<{ Type: string; URN: string; Outputs: Record<string, unknown> }>;
}

export async function fetchRecentEvents(project: SSTProject, timeoutMs: number = 2000): Promise<SSTEvent[]> {
  const events: SSTEvent[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${project.serverUrl}/stream`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to connect: ${response.statusText}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          try { events.push(JSON.parse(line) as SSTEvent); } catch {}
        }
      }
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") throw error;
  } finally {
    clearTimeout(timeout);
  }
  return events;
}

export async function fetchCompleted(project: SSTProject): Promise<CompleteEvent | null> {
  try {
    const response = await fetch(`${project.serverUrl}/api/completed`);
    if (!response.ok) return null;
    return (await response.json()) as CompleteEvent;
  } catch { return null; }
}

export async function isServerRunning(project: SSTProject): Promise<boolean> {
  try {
    const response = await fetch(`${project.serverUrl}/api/completed`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch { return false; }
}

export function groupEventsByType(events: SSTEvent[]): Record<string, SSTEvent[]> {
  const grouped: Record<string, SSTEvent[]> = {};
  for (const event of events) {
    if (!grouped[event.type]) grouped[event.type] = [];
    grouped[event.type].push(event);
  }
  return grouped;
}

export interface FunctionInvocation {
  functionId: string;
  requestId: string;
  workerId: string;
  input?: string;
  output?: string;
  error?: { type: string; message: string; trace: string[] };
  logs: string[];
}

export function extractFunctionInvocations(events: SSTEvent[]): FunctionInvocation[] {
  const invocations: Map<string, FunctionInvocation> = new Map();
  for (const event of events) {
    switch (event.type) {
      case "aws.FunctionInvokedEvent": {
        const evt = event.event as unknown as FunctionInvokedEvent;
        invocations.set(evt.RequestID, { functionId: evt.FunctionID, requestId: evt.RequestID, workerId: evt.WorkerID, input: evt.Input, logs: [] });
        break;
      }
      case "aws.FunctionLogEvent": {
        const evt = event.event as unknown as FunctionLogEvent;
        const inv = invocations.get(evt.RequestID);
        if (inv) inv.logs.push(evt.Line);
        break;
      }
      case "aws.FunctionResponseEvent": {
        const evt = event.event as unknown as FunctionResponseEvent;
        const inv = invocations.get(evt.RequestID);
        if (inv) inv.output = evt.Output;
        break;
      }
      case "aws.FunctionErrorEvent": {
        const evt = event.event as unknown as FunctionErrorEvent;
        const inv = invocations.get(evt.RequestID);
        if (inv) inv.error = { type: evt.ErrorType, message: evt.ErrorMessage, trace: evt.Trace };
        break;
      }
    }
  }
  return Array.from(invocations.values());
}
