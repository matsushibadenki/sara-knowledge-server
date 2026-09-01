# Signed SARA／Worker ingestion

## 日本語

通常VPS上のSARA、AI解析Worker、crawler、nightly batchはManaged PostgreSQLへ直接接続せず、HTTPSのKnowledge APIへEvent batchを送る。

### 認証と署名

- [Done] `memory:write`だけを持つAPI keyをWorkerごとに発行する。
- [Done] API key requestで`POST /api/v1/memory/events/bulk`を呼ぶ場合はHMAC-SHA256署名を必須とする。
- [Done] timestampは既定で現在時刻の±300秒以内とする。
- [Done] nonceはAPI key単位で一度だけ使用でき、競合insertにより並行replayも拒否する。
- [Done] `X-SARA-Idempotency-Key`は`batch_uid`と一致させる。同じbatchを新しいnonceで再送すると既存結果を返す。
- [Done] 署名検証後にのみnonceを保存する。期限切れnonceはindexed expiryを使って削除する。

必要header：

```text
Authorization: Bearer sara_...
X-SARA-Timestamp: Unix seconds
X-SARA-Nonce: 16〜128文字の一意値
X-SARA-Idempotency-Key: batch_uidと同じ値
X-SARA-Signature: sha256=<64 hex chars>
```

canonical string：

```text
POST
/api/v1/memory/events/bulk
<timestamp>
<nonce>
<idempotency-key>
<hex SHA-256 of exact request body bytes>
```

この文字列をAPI keyそのものをsecretとしてHMAC-SHA256署名する。TLSは必須であり、API keyや署名済みrequest bodyをログへ出さない。時刻同期にはNTPを使う。

JWTを使う管理画面や内部操作は既存フローを維持し、HMAC追加headerを要求しない。HMACは外部machine credentialの防御層であり、scope認可、所有者分離、Bulk APIの原子性を置き換えない。

## English

External workers use a narrowly scoped `memory:write` API key and never connect directly to Managed PostgreSQL. API-key calls to the bulk endpoint require an HMAC-SHA256 signature over method, path, timestamp, nonce, idempotency key, and the exact body hash. The default clock window is ±300 seconds. Nonces are consumed atomically per API key, while a retry uses a new nonce and the same batch UID.

TLS, clock synchronization, secret rotation, and log redaction remain operational requirements.

## 简体中文

外部Worker使用仅含`memory:write`权限的API key，并且不得直接连接Managed PostgreSQL。调用批量端点时，必须对方法、路径、时间戳、nonce、幂等键和精确请求体哈希执行HMAC-SHA256签名。默认时间窗口为±300秒。nonce按API key原子消费；安全重试必须使用新nonce和相同batch UID。

生产环境仍必须启用TLS、时钟同步、密钥轮换与日志脱敏。

## Roadmap

- [Done] HMAC signing, timestamp validation, nonce replay protection, and batch idempotency
- [Done] Indexed nonce retention and API-key-scoped uniqueness
- [Done] Queue-backed asynchronous Event ingestion for 501〜10,000 events
- [Next] Asset API with upload authorization and provenance binding
- [Later] API key rotation overlap and per-worker rate limits
