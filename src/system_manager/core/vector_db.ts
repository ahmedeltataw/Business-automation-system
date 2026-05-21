import { Pinecone } from '@pinecone-database/pinecone';
import { env } from '../../config/env';

interface KnowledgeRecord {
  text: string;
  source: string;
  type?: string;
  title?: string;
}

export class KingVectorDB {
  private pc: Pinecone | null = null;
  private index: ReturnType<Pinecone['index']> | null = null;
  private ready = false;

  async init(): Promise<void> {
    if (!env.PINECONE_API_KEY || !env.PINECONE_INDEX_NAME) {
      console.warn('[VectorDB] Pinecone not configured — skipping');
      return;
    }
    if (this.ready) return;
    this.pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
    this.index = this.pc.index(env.PINECONE_INDEX_NAME);
    this.ready = true;
  }

  async upsertKnowledge(
    id: string,
    text: string,
    metadata: Partial<KnowledgeRecord> = {}
  ): Promise<void> {
    if (!this.index) return;
    try {
      await this.index.upsertRecords({
        records: [{
          _id: id,
          text,
          source: metadata.source || 'unknown',
          type: metadata.type || 'general',
          title: metadata.title || '',
        }],
      });
      console.log(`[VectorDB] Upserted ${id}`);
    } catch (err: any) {
      console.error(`[VectorDB] Upsert failed: ${err.message}`);
    }
  }

  async queryKingMemory(query: string, limit = 5): Promise<{ text: string; score: number; source: string }[]> {
    if (!this.index) return [];
    try {
      const result = await this.index.searchRecords({
        query: {
          inputs: { text: query },
          topK: limit,
        },
        fields: ['text', 'source', 'type', 'title'],
      });
      return (result.result?.hits || [])
        .filter(h => h._score && h.fields)
        .map(h => ({
          text: (h.fields as Record<string, string>)?.text || '',
          score: h._score,
          source: (h.fields as Record<string, string>)?.source || 'unknown',
        }));
    } catch (err: any) {
      console.error(`[VectorDB] Query failed: ${err.message}`);
      return [];
    }
  }

  get isReady(): boolean {
    return this.ready;
  }
}

export const kingVectorDB = new KingVectorDB();
