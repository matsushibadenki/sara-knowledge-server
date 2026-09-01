# Signed Worker ingestion progress — 2026-08-31

- [Done] Added `auth.api_request_nonces` with API-key nonce uniqueness and expiry index.
- [Done] Added exact-body HMAC-SHA256 verification for API-key Bulk Event requests.
- [Done] Added timestamp, nonce, and idempotency-key validation.
- [Done] Verified unsigned rejection, valid signature, nonce replay rejection, safe retry, expired timestamp, and body tampering.
- [Done] Migration `0020_married_ma_gnuci.sql` applied successfully.
- [Done] Integration suite passed 10 tests and 321 assertions.
- [Done] Queue-backed asynchronous Event ingestion for 501〜10,000 events.
- [Done] Asset API with upload authorization and provenance binding.
- [Next] Asset processing jobs and derived-Asset provenance.
