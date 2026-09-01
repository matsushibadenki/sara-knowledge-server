# Async Event ingestion progress — 2026-09-01

- [Done] Added `memory.event_ingestion_jobs` and raised persisted batch capacity to 10,000.
- [Done] Added async create, status, replay, conflict, and cancellation APIs.
- [Done] Added Worker claim, MinIO read, atomic bulk insert, failure rollback, and stale recovery.
- [Done] Applied migration `0021_peaceful_enchantress.sql`.
- [Done] Verified a real 501-event job through API, Redis, Worker, MinIO, and PostgreSQL.
- [Done] Passed 10 tests and 335 assertions.
- [Next] Asset API with upload authorization and provenance binding.

