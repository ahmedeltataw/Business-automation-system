# AI Prompt Engineering — RAG, LLM Orchestration & Production Patterns

## Core Principles
- Priming: set model identity and constraints upfront
- Specificity over length: precise instructions beat verbose prompts
- Chain-of-thought: request step-by-step reasoning for complex tasks
- Role anchoring: assign persona + expertise level + tone
- Output formatting: specify exact schema (JSON, markdown, XML)

## Prompt Patterns
- System/user/assistant role separation (OpenAI/Anthropic format)
- Few-shot: provide 2-5 examples of desired output
- Negative prompting: specify what NOT to do
- Hierarchical: break complex tasks into sub-prompts
- Reflexive: ask the model to verify its own output

## RAG (Retrieval-Augmented Generation)
- Chunking strategy: semantic boundaries (sections) over fixed token counts
- Embedding model selection: domain-specific > general-purpose
- Hybrid search: dense (vector) + sparse (BM25) for best recall
- Reranking: cross-encoder for precision after initial retrieval
- Context window management: summarize older chunks, keep relevant ones
- Metadata filtering: pre-filter by date/source/type before vector search

## LLM Orchestration
- Routing: classify input → route to specialized prompt/model
- Fallback chain: primary model → cheaper model → cached response
- Parallel decomposition: split task into independent sub-prompts
- Validation loop: LLM generates → code validates → retry on failure
- State machines: track conversation state for multi-turn tasks

## Production LLM Patterns
- Guardrails: input/output validation, PII masking, content filtering
- Caching: semantic cache (embedding similarity) for repeated queries
- Rate limiting: token bucket per user/model/tier
- Cost optimization: batch prompts, choose cheaper models for simple tasks
- Monitoring: token usage, latency distribution, error rates, score distribution
- A/B testing: compare prompt variants with statistical significance

## Embedding & Vector DB
- Chunk overlap: 10-20% of chunk size for context continuity
- Indexing strategy: IVF (fast approximate) or HNSW (high accuracy)
- Hybrid search weights: tune based on domain (semantic vs keyword heavy)
- Re-indexing cadence: incremental updates vs full rebuild

## Ethics
- Bias detection: audit responses for demographic skew
- Hallucination mitigation: force citations, verify facts against RAG source
- Prompt injection: sanitize user input, separate user context from instructions
