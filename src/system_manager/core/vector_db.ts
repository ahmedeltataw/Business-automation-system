import { Pinecone } from '@pinecone-database/pinecone';
import { env } from '../../config/env';

const EMBEDDING_MODEL = 'text-embedding-004';

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

  private async embed(text: string): Promise<number[]> {
    const { GoogleGenAI } = await import('@google/genai');
    if (!env.GEMINI_API_KEY) throw new Error('[VectorDB] GEMINI_API_KEY required for embeddings');
    const genAI = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const response = await genAI.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });
    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) throw new Error('[VectorDB] Empty embedding response');
    return values;
  }

  async upsertKnowledge(
    id: string,
    text: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.index) return;
    try {
      const values = await this.embed(text.slice(0, 8000));
      await this.index.upsert({
        records: [{
          id,
          values,
          metadata: { text: text.slice(0, 2000), ...metadata },
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
      const vector = await this.embed(query);
      const result = await this.index.query({
        vector,
        topK: limit,
        includeMetadata: true,
      });
      return result.matches
        .filter(m => m.metadata?.text && m.score)
        .map(m => ({
          text: m.metadata!.text as string,
          score: m.score!,
          source: (m.metadata?.source as string) || 'unknown',
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
