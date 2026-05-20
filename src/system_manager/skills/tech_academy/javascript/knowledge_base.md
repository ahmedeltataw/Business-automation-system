# Advanced JavaScript — Async, V8 & Production Patterns

## Event Loop Deep Dive
- Microtasks (Promise, queueMicrotask) run before macrotasks (setTimeout, setInterval, I/O)
- requestAnimationFrame runs before CSS style recomputation
- Node.js phases: timers → pending callbacks → idle/prepare → poll → check (setImmediate) → close
- `process.nextTick()` is NOT part of the event loop — it interrupts between phases

## Async Patterns
- Prefer `async/await` over raw promises or callbacks
- Promise.allSettled() for fault-tolerant parallel execution
- AbortController for cancellable async operations
- Avoid promise constructor antipattern — use async function instead
- ForEach is NOT promise-aware — use for...of or Promise.all

## V8 Engine Internals
- Ignition: bytecode interpreter (fast startup)
- TurboFan: JIT compiler for hot code (optimized machine code)
- Inline caching: monomorphic > polymorphic > megamorphic
- Hidden classes: don't dynamically add/delete properties (breaks IC)
- Deoptimization: try/catch inside hot functions prevents optimization
- V8 memory: young generation (scavenge) → old generation (mark-sweep)

## Memory Management
- WeakMap/WeakSet for caches without preventing GC
- Closures capture entire scope — avoid capturing large objects in hot paths
- Detached DOM nodes are common memory leak source
- Use performance.memory for heap diagnostics

## Production Patterns
- Structured concurrency: use Promise.allSettled() for batch operations
- Circuit breaker pattern for external API calls
- Backpressure: use streams/observables for large data flows
- Worker threads for CPU-intensive tasks
- Module federation for micro-frontends

## Security
- Content Security Policy headers
- Input sanitization (never trust user input)
- Proper CORS configuration
- Avoid eval(), new Function(), document.write()

## Tooling
- TypeScript for type safety
- ESLint + Prettier for code quality
- Vitest/Jest for testing
- Webpack/Rollup/Vite for bundling
