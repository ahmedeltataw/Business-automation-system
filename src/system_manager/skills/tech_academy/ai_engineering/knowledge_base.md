# AI Engineering — Agentic Frameworks & Production Systems Guide

## Agent Architecture
- Perception → Reasoning → Action loop (similar to orchestrator.ts)
- Tool use: define function schemas (JSON) that the LLM can call
- Memory: short-term (conversation context) + long-term (vector store)
- Planning: hierarchical task decomposition with rollback
- Reflection: self-critique and correction loops

## Agentic Frameworks
- LangGraph: state machines with nodes/edges, conditional routing
- CrewAI: role-based multi-agent teams (researcher, writer, critic)
- AutoGen: Microsoft's conversational agent framework
- Haystack: pipeline-based (document processing + LLM querying)
- Smolagents: HuggingFace's lightweight agent framework
- Vercel AI SDK: streaming, tool calling, multi-modal

## Multi-Agent Systems
- Supervisor pattern: orchestrator delegates to specialized sub-agents
- Debate pattern: multiple agents argue different positions, synthesizer resolves
- Voting pattern: multiple agents run the same task, majority decides
- Swarm pattern: agents discover and collaborate dynamically

## Production AI Systems
- Observability: trace every LLM call (prompt, response, latency, cost, tokens)
- Caching: semantic cache + exact-match cache at multiple layers
- Rate limiting: per-user, per-model, per-tier with token bucket
- Fallback chain: primary → secondary → tertiary model, with cooldown
- Circuit breaker: disable failing models after N errors, retry after window
- Retry with exponential backoff + jitter

## Evaluation
- Unit tests: known input → expected structured output
- Golden dataset: 50-100 examples covering edge cases
- LLM-as-judge: use another LLM to evaluate output quality
- Score distribution monitoring: flag drifts in average score
- A/B testing: compare prompt changes with statistical significance

## Safety & Guardrails
- Input validation: reject malformed or injection attempts
- Output validation: verify schema, ranges, allowed values
- PII masking: before sending to LLM, redact sensitive info
- Content filtering: block toxic, biased, or unsafe outputs
- Human-in-the-loop: escalate high-stakes decisions to human review

## Deployment
- Model routing: classify request → route to cheapest capable model
- Batching: combine multiple prompts into one call when possible
- Streaming: stream responses for better UX (SSE or WebSocket)
- Caching strategy: semantic cache for repeated patterns, exact for identical
- Monitoring: real-time dashboards for latency, error rate, cost per request
