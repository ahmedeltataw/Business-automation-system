/**
 * Learning Memory — Self-Evolution Layer
 *
 * Persistent journal of agent performance, success/failure outcomes, and
 * platform responses. Every browser workflow reads this context beforehand
 * so the agent dynamically self-corrects across sessions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(__dirname, '..', '..', '.agent');
const LOG_PATH = join(LOG_DIR, 'learning_log.json');

export interface LearningEntry {
  timestamp: string;
  platform: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial' | 'blocked';
  lesson: string;
  metadata?: Record<string, unknown>;
}

export interface LearningMemory {
  version: number;
  totalRuns: number;
  entries: LearningEntry[];
}

function ensureLogFile(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  if (!existsSync(LOG_PATH)) {
    const seed: LearningMemory = { version: 1, totalRuns: 0, entries: [] };
    writeFileSync(LOG_PATH, JSON.stringify(seed, null, 2), 'utf-8');
  }
}

function readMemory(): LearningMemory {
  ensureLogFile();
  try {
    const raw = readFileSync(LOG_PATH, 'utf-8');
    return JSON.parse(raw) as LearningMemory;
  } catch {
    const seed: LearningMemory = { version: 1, totalRuns: 0, entries: [] };
    writeFileSync(LOG_PATH, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
}

function writeMemory(memory: LearningMemory): void {
  ensureLogFile();
  writeFileSync(LOG_PATH, JSON.stringify(memory, null, 2), 'utf-8');
}

export async function loadLearningContext(): Promise<LearningEntry[]> {
  const memory = readMemory();
  const recent = memory.entries.slice(-20);
  return recent;
}

export async function appendLearning(entry: LearningEntry): Promise<void> {
  const memory = readMemory();
  memory.entries.push(entry);
  memory.totalRuns = memory.entries.length;
  writeMemory(memory);
}

export async function getPerformanceSummary(): Promise<{
  total: number;
  successRate: number;
  topLessons: string[];
}> {
  const memory = readMemory();
  const successes = memory.entries.filter((e) => e.outcome === 'success').length;

  const platformOutcomes = new Map<string, number>();
  for (const e of memory.entries) {
    if (e.outcome === 'failure') {
      platformOutcomes.set(e.platform, (platformOutcomes.get(e.platform) ?? 0) + 1);
    }
  }
  const topLessons = [...platformOutcomes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => `Recurring failures on ${p}`);

  return {
    total: memory.totalRuns,
    successRate: memory.totalRuns > 0 ? successes / memory.totalRuns : 0,
    topLessons,
  };
}

export async function resetLearningMemory(): Promise<void> {
  const seed: LearningMemory = { version: 1, totalRuns: 0, entries: [] };
  ensureLogFile();
  writeFileSync(LOG_PATH, JSON.stringify(seed, null, 2), 'utf-8');
}
