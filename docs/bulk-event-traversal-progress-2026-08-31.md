# Bulk Event／bounded traversal progress — 2026-08-31

- [Done] Added `memory.event_ingestion_batches` and ordered batch membership.
- [Done] Added atomic ingestion, canonical idempotency hashing, replay responses, and conflict rollback.
- [Done] Added bounded graph traversal with ownership and temporal filters.
- [Done] Added OpenAPI paths and integration coverage for replay, conflict, rollback, depth, filtering, and limits.
- [Done] Applied migrations `0018` and `0019` to development PostgreSQL.
- [Done] Passed 10 tests and 307 assertions against PostgreSQL and Redis.
- [Next] Add HMAC-authenticated HTTPS ingestion for SARA and external workers.
- [Later] Add queue-backed asynchronous ingestion for larger batches.
