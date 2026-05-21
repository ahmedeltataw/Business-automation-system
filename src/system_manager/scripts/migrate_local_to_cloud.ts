import * as fs from 'fs';
import * as path from 'path';
import { kingVectorDB } from '../core/vector_db';

const SKILLS_ROOT = path.resolve(__dirname, '..', 'skills');
const INCLUDED_EXTENSIONS = new Set(['.md', '.json']);

interface FileEntry {
  relativePath: string;
  content: string;
  sourceType: string;
}

function collectFiles(dir: string, baseDir: string): FileEntry[] {
  const entries: FileEntry[] = [];

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        entries.push(...collectFiles(fullPath, baseDir));
      } else if (item.isFile() && INCLUDED_EXTENSIONS.has(path.extname(item.name))) {
        const relativePath = path.relative(baseDir, fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const sourceType = relativePath.startsWith('sales_closer') ? 'sales_closer'
          : relativePath.startsWith('personal_branding') ? 'personal_branding'
          : relativePath.startsWith('content_creator') ? 'content_creator'
          : 'tech_academy';
        entries.push({ relativePath, content, sourceType });
      }
    }
  } catch (err: any) {
    console.error(`[Migration] Error reading ${dir}: ${err.message}`);
  }

  return entries;
}

function chunkText(
  text: string,
  chunkSize: number,
  overlap: number
): { index: number; text: string }[] {
  if (text.length <= chunkSize) {
    return [{ index: 0, text }];
  }

  const chunks: { index: number; text: string }[] = [];
  let start = 0;
  let chunkIdx = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let segment = text.slice(start, end);

    if (end < text.length) {
      const lastNewline = segment.lastIndexOf('\n');
      const lastSpace = segment.lastIndexOf(' ');
      const breakAt = Math.max(lastNewline, lastSpace);
      if (breakAt > chunkSize * 0.5) {
        segment = text.slice(start, start + breakAt);
        start = start + breakAt - overlap;
      } else {
        start = end - overlap;
      }
    } else {
      start = text.length;
    }

    chunks.push({ index: chunkIdx++, text: segment.trim() });
  }

  return chunks;
}

async function main(): Promise<void> {
  console.log('=== ELKing Local Knowledge → Pinecone Cloud Migration ===\n');

  await kingVectorDB.init();
  if (!kingVectorDB.isReady) {
    console.error('[Migration] Pinecone not configured. Set PINECONE_API_KEY and PINECONE_INDEX_NAME in .env');
    process.exit(1);
  }

  const files = collectFiles(SKILLS_ROOT, SKILLS_ROOT);
  console.log(`Found ${files.length} files to migrate.\n`);

  const CHUNK_SIZE = 1000;
  const CHUNK_OVERLAP = 200;
  let totalChunks = 0;
  let totalFiles = 0;
  let totalErrors = 0;

  for (const file of files) {
    const chunks = chunkText(file.content, CHUNK_SIZE, CHUNK_OVERLAP);
    totalFiles++;

    process.stdout.write(`  [${totalFiles}/${files.length}] ${file.relativePath} (${chunks.length} chunks) ... `);

    let fileErrors = 0;
    for (const chunk of chunks) {
      const id = `${file.relativePath.replace(/[\\\/.]/g, '_')}_chunk${chunk.index}`;
      try {
        await kingVectorDB.upsertKnowledge(id, chunk.text, {
          source: file.sourceType,
          type: 'skill_knowledge',
          title: file.relativePath,
        });
        totalChunks++;
        process.stdout.write('.');
      } catch (err: any) {
        fileErrors++;
        totalErrors++;
        process.stdout.write('x');
      }
    }

    console.log(fileErrors > 0 ? ` (${fileErrors} errors)` : ' done');
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`  Files processed:  ${totalFiles}`);
  console.log(`  Chunks upserted:  ${totalChunks}`);
  console.log(`  Errors:           ${totalErrors}`);
}

main().catch((err) => {
  console.error(`\n[Migration] Fatal: ${err.message}`);
  process.exit(1);
});
