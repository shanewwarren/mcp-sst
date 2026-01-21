import * as fs from "fs";
import * as path from "path";

export interface SSTProject {
  root: string;
  stage: string;
  serverUrl: string;
  logDir: string;
}

export function findSSTConfig(startDir: string): string | null {
  let current = startDir;
  while (current !== path.dirname(current)) {
    const sstConfig = path.join(current, "sst.config.ts");
    const sstConfigJs = path.join(current, "sst.config.js");
    if (fs.existsSync(sstConfig)) return sstConfig;
    if (fs.existsSync(sstConfigJs)) return sstConfigJs;
    current = path.dirname(current);
  }
  return null;
}

export function getAvailableStages(projectRoot: string): string[] {
  const sstDir = path.join(projectRoot, ".sst");
  if (!fs.existsSync(sstDir)) return [];
  const files = fs.readdirSync(sstDir);
  return files.filter((f) => f.endsWith(".server")).map((f) => f.replace(".server", ""));
}

export function discoverSSTServer(projectRoot: string, stage: string): SSTProject | null {
  const serverFile = path.join(projectRoot, ".sst", `${stage}.server`);
  if (!fs.existsSync(serverFile)) return null;
  const serverUrl = fs.readFileSync(serverFile, "utf-8").trim();
  const logDir = path.join(projectRoot, ".sst", "log");
  return { root: projectRoot, stage, serverUrl, logDir };
}

export function autoDiscover(startDir: string = process.cwd()): SSTProject[] {
  const configPath = findSSTConfig(startDir);
  if (!configPath) return [];
  const projectRoot = path.dirname(configPath);
  const stages = getAvailableStages(projectRoot);
  const projects: SSTProject[] = [];
  for (const stage of stages) {
    const project = discoverSSTServer(projectRoot, stage);
    if (project) projects.push(project);
  }
  return projects;
}

export interface LogFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
}

export function getLogFiles(project: SSTProject): LogFile[] {
  if (!fs.existsSync(project.logDir)) return [];
  const files = fs.readdirSync(project.logDir);
  const logFiles: LogFile[] = [];
  for (const file of files) {
    if (file.endsWith(".log")) {
      const filePath = path.join(project.logDir, file);
      const stats = fs.statSync(filePath);
      logFiles.push({
        name: file.replace(".log", ""),
        path: filePath,
        size: stats.size,
        modifiedAt: stats.mtime,
      });
    }
  }
  return logFiles.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

export function readLastLines(filePath: string, lineCount: number): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  return lines.slice(-lineCount);
}

export function readLogLines(
  filePath: string,
  offset: number = 0,
  limit: number = 100
): { lines: string[]; total: number; hasMore: boolean } {
  if (!fs.existsSync(filePath)) return { lines: [], total: 0, hasMore: false };
  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n").filter((line) => line.trim());
  const total = allLines.length;
  const startIndex = Math.max(0, total - offset - limit);
  const endIndex = total - offset;
  const lines = allLines.slice(startIndex, endIndex).reverse();
  return { lines, total, hasMore: startIndex > 0 };
}
