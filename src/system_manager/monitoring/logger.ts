import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.resolve(__dirname, '..', '..', '..', '.agent');
const LOG_FILE = path.join(LOG_DIR, 'elking.log');

let stream: fs.WriteStream | null = null;
let patched = false;

function getStream(): fs.WriteStream {
  if (!stream) {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  }
  return stream;
}

function formatLine(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return `[${ts}] [${level}] ${msg}\n`;
}

function write(level: string, args: unknown[]): void {
  const line = formatLine(level, args);
  getStream().write(line);
}

export function initLogger(): void {
  if (patched) return;
  patched = true;

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    write('LOG', args);
    origLog.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    write('WARN', args);
    origWarn.apply(console, args);
  };

  console.error = (...args: unknown[]) => {
    write('ERROR', args);
    origError.apply(console, args);
  };

  console.log(`[Logger] Writing to ${LOG_FILE}`);
}

export function getLogPath(): string {
  return LOG_FILE;
}
