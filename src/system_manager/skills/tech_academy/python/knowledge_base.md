# Python — Metaprogramming & Memory Management Guide

## Metaprogramming
- Decorators: higher-order functions that transform callables
- Class decorators: modify class creation (vs metaclasses for inheritance trees)
- Metaclasses: `__new__` controls class creation (use sparingly)
- `__getattr__` vs `__getattribute__`: former called on attribute miss, latter on every access
- Descriptors: `__get__`, `__set__`, `__delete__` control attribute access on classes
- `__slots__`: reduce memory footprint and speed up attribute access
- `dataclasses`: auto-generate `__init__`, `__repr__`, `__eq__`, `__hash__`
- `property`: computed attributes with getter/setter/deleter
- `contextlib.contextmanager`: create context managers without writing a class

## Memory Management
- Reference counting + generational GC (cyclic garbage)
- `gc` module: `gc.get_objects()`, `gc.set_threshold()` for tuning
- `weakref`: prevent circular references from preventing GC
- `__del__`: finalizer (unreliable — use context managers instead)
- Memory profiling: `tracemalloc`, `memory_profiler`, `objgraph`
- Object pools: `__slots__` + `array.array` for numeric data
- Generators/iterators: lazy evaluation, memory-efficient streaming

## Async Python
- `asyncio.run()` as main entry point
- `await` only in async functions, never block with `time.sleep()` in async code
- `asyncio.gather()` for concurrent tasks, `asyncio.create_task()` for fire-and-forget
- `asyncio.Queue` for producer-consumer patterns
- `anyio` for structured concurrency with cancellation scopes

## Performance
- `__slots__` reduces memory 40-60% for many instances
- `lru_cache` for memoization
- Local variable bindings: `local_func = obj.method` for hot loops
- `map`/`filter` vs comprehensions: comprehensions usually faster
- C extensions: Cython, mypyc, PyPy for JIT compilation
- Profiling: `cProfile` first, then optimize — never guess

## Production Python
- Type hints with `mypy`/`pyright` for static analysis
- `pydantic` for runtime validation
- `structlog` for structured logging
- `httpx` for async HTTP (prefer over `requests` in new code)
- `pytest` with fixtures, parametrization, and plugins
- Configuration: `pydantic-settings` for env-based config
