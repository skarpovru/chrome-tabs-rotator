# Crash Resilience & Tab Preservation

This document summarizes the safeguards implemented to minimize risk of user tab loss during MV3 service worker restarts, crashes, or mid-initialization failures.

## Core Principles

1. **Non‑destructive Reinitialization** – Background restart must *never* delete or recreate already-managed tabs unless a deliberate prune condition is met.
2. **Deterministic Ownership** – We track only tabs we created previously (owned set) and leave foreign/user tabs untouched.
3. **Heuristic Validation** – A heartbeat timestamp + max age window decides whether prior state is considered fresh/preservable.
4. **Fail Safe, Not Fail Closed** – If initialization throws, previously owned tabs remain registered; no cleanup runs implicitly.
5. **Observability First** – Diagnostics surface preservation status, heartbeat freshness, owned tab counts, and pruning decisions.

## Implemented Safeguards

| Safeguard | Mechanism | Files / Areas |
|----------|-----------|---------------|
| Preservation Mode | `initialize({ preserveExisting: true })` retains existing owned tabs when heartbeat is fresh | `rotation.service.ts` |
| Heartbeat | Periodic write of `RotationHeartbeat` to storage for liveness detection | `rotation.service.ts` + `storage.service.ts` |
| Max Age Window | `PreserveHeartbeatMaxAgeSeconds` gating preservation vs. rebuild | Config / storage keys |
| Prune Session-Restored Tabs | Removes tabs resurrected by browser session restore that we no longer control | `prune-session-restored.bg-spec.ts` test coverage |
| Randomized Restart Robustness | Stress test loops through rapid restart sequences validating no duplication/loss | `rotation-random-restarts.bg-spec.ts` |
| Mid-Initialize Error Safety | Simulated `createTabs` failure ensures owned set unchanged | `rotation-initialize-error-safety.bg-spec.ts` |
| Toolbar Icon Guard | Skips icon operations if API unavailable (prevents noisy failures masking real issues) | `toolbar-manager.service.ts` + test |
| Diagnostics Panel | Displays preservation decisions & metrics for manual verification | `diagnostics-panel` module |

## Test Coverage Matrix

| Scenario | Covered By | Assertions |
|----------|------------|------------|
| Preserve on clean restart | existing preserve/resume specs | Owned tabs stable after restart |
| Rebuild on stale heartbeat | restart stress spec (stale segment) | Fresh tabs created after explicit stale simulation |
| Rapid repeated restarts | `rotation-random-restarts.bg-spec.ts` | No duplicates; state size constant |
| Session restored foreign tabs pruned | `prune-session-restored.bg-spec.ts` | Extraneous restored tabs removed only when appropriate |
| Mid-initialize thrown error | `rotation-initialize-error-safety.bg-spec.ts` | Exception propagated; owned set unchanged |
| Toolbar guard paths | `toolbar-manager.bg-spec.ts` | Guard prevents error spam & sets icon when available |

## Operational Best Practices

1. **Avoid clearing storage** except via explicit user action—preservation depends on persisted heartbeat/state.
2. **Short Heartbeat Interval** relative to max-age ensures quick detection of stale states without false staleness (balance to reduce write churn).
3. **Idempotent Initialization** – Ensure `initialize` can run safely multiple times with no destructive side effects when preservation active.
4. **Scoped Pruning** – Only prune tabs positively identified as previously owned but invalid (e.g., closed externally or resurrected incorrectly) to avoid collateral tab loss.
5. **Explicit Error Boundaries** – Wrap sub-steps (config load, tab creation) so a failure doesn't cascade into cleanup phases.
6. **Structured Metrics** – Track counters (restarts, preserved resumes, rebuilds, prunes) for anomaly alerting.

## Future Enhancements (Optional)

- Add metric emission & aggregation around failed vs. successful initialize cycles.
- Introduce fuzz tests for randomized timing between heartbeat writes and forced restarts.
- Persist a rolling restart counter with time window to detect pathological restart loops (environment instability).
- Add integration test simulating mixed user + owned tabs across multiple windows.

## Developer Checklist for Changes Touching Rotation

Before merging changes affecting rotation lifecycle:

- [ ] Run background test suite (`*.bg-spec.ts`) and confirm all pass.
- [ ] Verify diagnostics panel still renders heartbeat + owned tab metrics.
- [ ] Manually simulate a service worker restart (disable/enable extension) and confirm tabs persist.
- [ ] Confirm no unbounded growth of owned set after repeated restarts.
- [ ] Review logs for absence of repeated toolbar icon failures.

## Quick Glossary

- **Owned Tab**: A tab created and tracked by the rotation service for scheduled focus/refresh.
- **Preservation Resume**: A restart path where previously owned tabs are reused instead of recreated.
- **Stale Heartbeat**: Heartbeat older than configured max age; triggers fresh rebuild of rotation set.

---
Maintaining these safeguards + tests ensures MV3 lifecycle quirks do not degrade user trust via silent tab loss.
