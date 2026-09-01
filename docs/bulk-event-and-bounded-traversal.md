# Bulk Event ingestion and bounded graph traversal

## 日本語

- [Done] `POST /api/v1/memory/events/bulk`は1〜500件を単一トランザクションで登録する。
- [Done] creator単位の`batch_uid`と正規化済み内容のSHA-256により、同じ内容の再送は既存結果を入力順で返す。
- [Done] 内容変更または既存`event_uid`との競合は`409`とし、部分登録を残さない。
- [Done] Source／Experience参照は集合単位で検証し、N+1 queryを避ける。
- [Done] `POST /api/v1/memory/traverse`は所有者、有効期間、検証状態、confidence、関係種別、方向を適用する。
- [Done] hard limitは深さ5、開始点10、ノード200、エッジ2,000である。

入力順は`batch_position`に保存するため、時刻が同値でもSARAのイベント列を再現できる。ハッシュはJSON objectのkey順に依存しない。探索は無制限の再帰SQLではなく、深さごとのbounded BFSである。responseの`meta`は到達深さ、件数、上限到達状態を返す。

本番ではKnowledge APIをXServer VPS CloudのApp VPSに置き、Managed PostgreSQLを正本、NFSを共有アセット領域とする。AI解析、crawler、夜間batchは通常VPS Workerへ分離できるが、Managed PostgreSQLへ直接接続しない。

```text
通常VPS Worker
  └─ HTTPS / job queue
       └─ App VPS Knowledge API
            ├─ Managed PostgreSQL（正本）
            └─ NFS（共有アセット）
```

## English

The bulk endpoint atomically ingests 1–500 ordered events. A creator-scoped batch UID and canonical SHA-256 make exact retries safe; changed payloads or event UID collisions return `409` without partial writes. Bounded BFS enforces ownership, temporal validity, verification, confidence, relation, direction, and hard resource limits. Production workers use HTTPS or a job queue and never connect directly to Managed PostgreSQL.

## 简体中文

批量端点在单个事务中写入1至500个有序事件。创建者范围内的批次UID与规范化SHA-256保证相同请求可安全重试；内容变化或事件UID冲突返回`409`且不留下部分数据。有界BFS应用所有者、有效时间、验证状态、置信度、关系类型、方向及资源上限。生产Worker仅使用HTTPS或作业队列，不直接连接Managed PostgreSQL。

## Roadmap

- [Done] Atomic, ordered, idempotent Bulk Event ingestion
- [Done] Bounded and filtered memory graph traversal
- [Done] SARA／external Worker HTTPS ingestion with HMAC signing and replay protection
- [Done] Queue-backed asynchronous ingestion for 501〜10,000 events
- [Next] Asset API with upload authorization and provenance binding
