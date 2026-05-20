# Clean Code — Engineering Excellence Guide

## Core Philosophy
Code is read far more often than it is written. Every line is a communication act.

## Naming
- Reveal intent: `elapsedTimeInDays`, not `d`
- Avoid disinformation: don't use `accountList` if it's not a `List`
- Meaningful distinctions: `moneyAmount` vs `money`, not `a1`, `a2`
- Pronounceable: `generationTimestamp`, not `genymdhms`
- Searchable: single-letter names only for local scope

## Functions
- Small: max 20 lines
- Do one thing: single level of abstraction per function
- DRY: no duplicated blocks
- Command-query separation: either do something or answer something
- Prefer exceptions over error codes
- Extract try/catch blocks into their own function

## Comments
- Only explain WHY, never WHAT (the code says what)
- Legal comments at module level only
- TODO comments are technical debt — track in system, not code
- Never comment-out code — delete it (git remembers)

## Objects & Data
- Prefer polymorphism over switch statements
- Law of Demeter: talk only to immediate friends
- Tell, don't ask

## Error Handling
- Use exceptions, not return codes
- Context is king: wrap exceptions with meaningful messages
- Define exception class hierarchy by caller needs, not by source

## Boundaries
- Third-party code: wrap in adapters
- Never pass mock-able types across boundaries
- Learning tests: prove third-party code works before using it

## Unit Tests
- ONE assertion per test (conceptually)
- FIRST: Fast, Independent, Repeatable, Self-validating, Timely
- Test one concept per test
- Production code != test code — tests can be less DRY

## Classes
- Small: single responsibility
- High cohesion: methods should use instance variables
- Organization: constants, fields, public methods, private methods

## Systems
- Separate construction from use (Dependency Injection)
- Keep concurrency concerns decoupled
- Use the simplest concurrency mechanism that works
