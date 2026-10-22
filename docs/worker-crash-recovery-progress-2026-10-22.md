# Worker crash recovery / Worker強制終了 / Worker强制终止

2026-10-22

🟢 [Done] `bun scripts/test-worker-crash.js` uses a fresh Compose project with private PostgreSQL/MinIO volumes and the actual Worker image. It publishes no ports and never stops or changes the normal development project. The test creates temporary PostgreSQL triggers only in its own database, waits for `PgSleep`, sends Docker `SIGKILL`, and checks container exit code 137. It waits for the database operation to settle before checking results. Recovery uses the configured 10-second lease, heartbeat and reaper; the test does not rewrite lease timestamps. Redis is unreachable so processing also exercises database polling. Normal failures and cooperative interruption clean up the test project and volumes. A host/daemon crash or uncatchable test-runner kill can require manual cleanup of the printed `sara-crash-*` project.

## 日本語

- Import: 37行目のトランザクション内でkill。確定済み36行と進捗表示30行を区別して確認する。不正行1件を含むため、Record／Versionは35件。処理中のRecord／Versionはrollbackされる。再起動後は確定済み行から再開し、100行、成功98件、不正行2件、Record／Version／監査98件になる。行番号の欠落・重複がなく、claim世代と試行回数が2、leaseと所有者が解除済みであることを検証する。
- Export: object保存後、完了UPDATEの実行中にkill。送信済みのautocommit SQLはクライアント終了後にもcommitできるため、完了済みなら世代1の結果、未確定なら再claimした世代2の結果を検証する。いずれも参照object、98件の内容、byte数、SHA-256が一致することを要求する。世代1の未参照objectが残る場合の回収は、この試験の対象外。
- Memory Event: 501件の一括INSERTの251件目でkill。Eventとingestion batchが両方0件へrollbackされ、Jobが未完了のままであることを確認する。再実行後はbatchが1件、Eventが501件となり、event UID・batch位置に重複や欠落がなく、Jobがそのbatchを参照することを検証する。

本番動作を遅らせるfault hookやschema migrationは追加していない。CIではimage build後に同じ試験を実行する。長時間JobをDB側の一時停止で再現した試験であり、全命令位置でのクラッシュ、ホスト電源断、本番providerの耐久性まで保証するものではない。

## English

Import crashes inside row 37 with 36 durable results but progress only at 30. Recovery must produce exactly 98 records, versions and audit entries, plus two rejected rows among 100 unique row results. Memory ingestion crashes halfway through a 501-event transaction; no partial batch survives, and recovery commits one batch with 501 unique events. Both retries must finish on claim/attempt 2 with ownership and lease cleared. Export crashes after object storage and during its completion UPDATE. Since an already submitted autocommit statement can commit after client death, either a durable generation-1 completion or a recovered generation-2 completion is accepted, but its object reference, payload, byte count and SHA-256 must agree. Unreferenced prior-claim export object collection remains outside this test.

No production delay hooks or schema migrations are introduced. CI executes the same disposable test after building images. This checks specific real process-kill boundaries, not every instruction boundary, host power loss or production storage durability.

## 简体中文

Import在第37行事务中被强制终止：已提交36行，但进度仅记录到30行。恢复后必须得到100条无缺失、无重复的行结果，其中成功98条、不合法2条，Record／Version／审计各98条。Memory在501个Event的批量INSERT中途被终止，Event及batch均完整回滚；恢复后只能有1个batch和501个唯一Event。两种恢复任务的claim及尝试次数均为2，所有者和lease已清除。Export在object写入后、完成UPDATE执行中被终止。已发送的autocommit SQL可能在客户端退出后仍提交，因此允许已持久化的世代1完成状态，或重新claim后的世代2完成状态；但object引用、内容、字节数和SHA-256必须一致。旧claim未引用object的清理不属于本试验范围。

未向生产代码添加延时hook或schema migration。CI在构建image后执行相同隔离试验。本试验覆盖特定真实进程终止位置，不保证所有指令位置、主机断电或生产存储的耐久性。

⭕️ [Pending] Production/off-host recovery, actual credentials and RPO/RTO measurement remain on hold until a suitable environment exists.
