# Queue-backed asynchronous Event ingestion

## 日本語

`POST /api/v1/memory/events/async`は501〜10,000件のEventを受け付ける。同期Bulk APIの上限500件は維持する。

```text
HTTPS API
  ├─ schema・参照・重複検証
  ├─ canonical content hash
  ├─ MinIOへ原本保存
  ├─ PostgreSQLへqueued job作成
  └─ Redisへwake-up通知
       ↓
Worker
  ├─ FOR UPDATE SKIP LOCKEDでclaim
  ├─ MinIO原本読込
  └─ Batch＋全Eventを単一transactionで確定
```

- [Done] creator＋`batch_uid`で冪等化し、同じ内容は既存jobを返す。
- [Done] 同じ`batch_uid`で内容が異なる場合は`409`を返す。
- [Done] Eventの入力順を`batch_position`へ保存する。
- [Done] Batch insert、全Event insert、job completionを一つのtransactionに含める。
- [Done] UID競合やDB errorではtransaction全体をrollbackし、jobを`failed`にする。
- [Done] Worker停止から5分経過した`processing` jobを`queued`へ戻す。
- [Done] queued／processing jobへcancel requestを設定できる。Workerが確定処理を始める前に確認する。
- [Done] API key呼び出しにはHMAC署名を要求する。cancel操作は現在JWT userだけに限定する。

Redisはwake-up通知であり、jobの正本ではない。通知が失われてもWorkerはPostgreSQL queueをpollする。これにより通常VPS Workerを再起動してもjobを回復できる。

大規模batchをchunkごとに公開すると中間状態が利用者から見えるため採用しない。現在は最大10,000件を一括確定する。将来さらに大きくする場合はstaging tableへchunk保存し、最後に短い確定transactionで公開する。

## English

The asynchronous endpoint accepts 501–10,000 events. It stores the validated source in MinIO, persists the job in PostgreSQL, and uses Redis only as a wake-up signal. Workers claim jobs with `FOR UPDATE SKIP LOCKED`. The final batch, all ordered events, and job completion are committed in one transaction, so partial event visibility is impossible.

Stale processing jobs are re-queued after five minutes. API-key submissions retain HMAC and batch idempotency requirements.

## 简体中文

异步端点接收501至10,000个事件。验证后的原始内容保存在MinIO，作业状态以PostgreSQL为准，Redis仅用于唤醒Worker。Worker通过`FOR UPDATE SKIP LOCKED`领取作业。最终批次、全部有序事件和作业完成状态在同一事务中提交，因此不会出现部分事件可见的情况。

处理超过五分钟的失效作业会重新排队。API key提交继续要求HMAC签名与批次幂等性。

## Roadmap

- [Done] Object-backed jobs, PostgreSQL claim, Redis wake-up, cancellation, stale recovery
- [Done] Atomic publication of 501–10,000 ordered events
- [Done] Asset API with upload authorization and provenance binding
- [Next] Asset processing jobs and derived-Asset provenance
- [Later] Staged ingestion for batches larger than 10,000
