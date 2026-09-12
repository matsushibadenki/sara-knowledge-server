# G0.4 Job recovery milestone

更新: 2026-09-12

## 日本語

- [Done] Import、Export、Memory Event Jobへ`claim_generation`、`attempt_count`、`max_attempts`、`heartbeat_at`、`lease_expires_at`、`next_attempt_at`を追加した。
- [Done] claim時にleaseと世代を発行し、進捗・取消・完了・失敗をworker IDと世代でfenceした。旧Workerは新しいclaimの状態を確定できない。
- [Done] heartbeatと定期reaperを実装した。期限切れJobは上限内なら再queueし、上限到達時はfailedにする。移行前からprocessingだったJobもmigration時に期限切れへbackfillする。
- [Done] Redis通知をtimeout付きの補助経路とし、停止中もPostgreSQL pollingを継続する。3種類のqueueはround-robinでclaimする。
- [Done] Docker試験でlease切れの再claim、retry上限、旧世代更新0件、Redis停止時完了、継続失敗Importがある場合のExport完了を確認する。
- [Next] G0.3bとして既存の巨大統合ケースを責務別に分割する。
- [Next] G0.5として世代別Exportが残す孤立objectを含め、Asset確定・参照保持・削除再試行・DB＋object復元を実装する。

## English

- [Done] Import, Export, and Memory Event jobs now carry lease, heartbeat, claim generation, retry count, retry limit, and next-attempt fields.
- [Done] Every state-changing worker write is fenced by worker ID and claim generation. A delayed worker cannot finalize a newer claim.
- [Done] Heartbeats extend leases and a periodic reaper requeues expired work or fails exhausted work. The migration expires pre-existing processing claims.
- [Done] Redis is a timeout-bounded notification path; PostgreSQL polling remains active during an outage. Queue types are claimed round-robin.
- [Done] A Docker integration check covers expired leases, bounded retries, stale-claim rejection, Redis outage fallback, and cross-type fairness.
- [Next] Split the broad integration test by responsibility under G0.3b.
- [Next] Implement G0.5 asset finalization, retention, retryable deletion, orphan reconciliation, and database-plus-object restore.

## 简体中文

- [Done] 导入、导出和记忆事件任务已增加租约、心跳、领取世代、重试次数、重试上限和下次尝试时间。
- [Done] Worker的状态写入同时校验worker ID和领取世代，延迟的旧Worker无法提交新领取的结果。
- [Done] 心跳会延长租约，定期回收器会重新排队过期任务，并在达到上限时标记失败。迁移也会使旧版遗留的processing任务过期。
- [Done] Redis只作为有超时限制的通知通道；Redis故障时继续轮询PostgreSQL。三类任务按轮转顺序领取。
- [Done] Docker集成测试覆盖租约过期、重试上限、旧世代更新为零、Redis故障回退和跨任务类型公平性。
- [Next] 在G0.3b中按职责拆分大型集成测试。
- [Next] 在G0.5中实现资源最终确认、引用保留、可重试删除、孤立对象核对以及数据库与对象联合恢复。
