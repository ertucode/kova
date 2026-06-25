# Test Suite TODO

## Runtime and API

- Add richer `kv.test.expect(...)` matchers beyond the current baseline set.
- Add response-specific helpers like `toHaveStatus`, `toHaveHeader`, and typed JSON helpers on `kv.test.expectResponse()`.
- Improve assertion diffs so structured failures show better object and string comparisons.
- Capture more precise source locations for test failures and hook failures.
- Decide whether tests should expose per-test console scoping instead of sharing the request console stream.

## Examples

- Expand async example matching beyond exact status/headers/body comparison.
- Support configurable body comparison modes for examples.
- Support better header comparison ergonomics for example matching.
- Add first-class UI actions to bind a saved example as a test baseline.

## UI

- Render the full suite/test tree in the live response panel, not only the compact summary.
- Add a dedicated visual presentation for passed/failed/skipped test cases in history cards.
- Add richer failure detail UI for test assertions, including expected/actual/diff views.
- Show latest test verdict badges in the explorer/request list.
- Add filtering for failed test runs in request history views.

## Data and Persistence

- Review whether persisting test runs as JSON on request history is enough long-term or whether dedicated test-run tables are needed.
- Add migration-safe handling for older history rows that do not have test results.

## Product Behavior

- Decide whether folder-level test orchestration should exist as a first-class feature later.
- Decide whether request-owned tests should eventually support folder inheritance.
- Decide whether async `describe(...)` should remain supported or be restricted.
- Decide whether `only` should have any visible safeguards in normal app usage.

## Shared Scripts

- Add clearer UI guidance for test-targeted shared scripts and mixed-target intersection behavior.
- Consider whether shared scripts targeted only to `test` should get dedicated affordances in the editor.

## Verification

- Add broader tests covering nested suites, hook failures, multiple `only` branches, and ambiguous example names.
- Add end-to-end coverage for request send -> test run -> history rendering.
