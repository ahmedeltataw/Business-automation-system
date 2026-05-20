# Go — Concurrency & Production Systems Guide

## Core Philosophy
- Simplicity over complexity: one way to do things
- Composition over inheritance (no classes, only structs + interfaces)
- Explicitness over implicitness (no implicit conversions, no magic)

## Concurrency Model
- Goroutines: lightweight (2KB stack), multiplexed onto OS threads
- Channels: communicate by sharing memory (don't share memory by communicating)
- Select: multiplex channel operations with timeout support
- Context: propagate cancellation, deadlines, and values across API boundaries
- sync.WaitGroup: coordinate goroutine completion
- sync.Mutex / sync.RWMutex: protect shared state
- errgroup: propagate errors from goroutines (golang.org/x/sync/errgroup)

## Concurrency Patterns
- Fan-out: one producer, multiple workers
- Fan-in: multiple producers, one consumer
- Pipeline: series of stages connected by channels
- Worker pool: bounded goroutine count with job queue
- Rate limiting: ticker + channel for throttling
- Context timeout: prevent goroutine leaks

## Production Systems
- Graceful shutdown: signal.NotifyContext + server.Shutdown()
- Health checks: /health, /ready endpoints
- Structured logging: zerolog or slog (avoid global loggers)
- Metrics: Prometheus histograms for latency distribution
- Tracing: OpenTelemetry for distributed tracing
- Configuration: env vars + struct validation (no config packages)

## Testing
- Table-driven tests: inputs + expected outputs
- go test -race: always run with race detector
- httptest.Server: mock HTTP services
- testify/require: readable assertions
- Fuzzing: go test -fuzz for edge case discovery

## Performance
- Profile-guided optimization (PGO): go build -pgo=auto
- escape analysis: prefer stack allocation
- sync.Pool: reduce GC pressure for frequently allocated objects
- Benchmarking: go test -bench=. -benchmem

## Error Handling
- Errors are values: check them explicitly
- Wrap errors with context: fmt.Errorf("context: %w", err)
- Sentinel errors for expected failures
- Use errors.Is() and errors.As() for unwrapping
