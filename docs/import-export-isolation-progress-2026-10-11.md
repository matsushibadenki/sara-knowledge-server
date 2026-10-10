# Import / Export integration isolation — 2026-10-11

## 日本語

🟢 [Done] G0.3bのImport／Exportを巨大ケースから同期・Workerの2ケースへ分割。JSON／JSONL／CSV、部分失敗、parse error、冪等再送と競合、承認迂回の拒否、成功Recordのdraft維持、非同期出力downloadとhashを検証する。

fixtureは返却されたJob IDをassert前に登録する。後処理では稼働中Jobへ取消要求を送り、最大10秒で終端状態を待つ。終端にならなければエラーを返し、Workerが利用中のデータは削除しない。Sourceから生成Recordを再取得して、途中失敗でもJob・行結果・版・監査・Source・object・refresh tokenを回収する。object削除失敗も報告し、残りのcleanupを続ける。

検証: `bun test`は18 pass／10 skip（外部サービス試験は無効）。Dockerの実PostgreSQL・Redis・MinIO・Workerで`docker compose run --rm -e RUN_INTEGRATION=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test`は24 pass／0 fail、482 assertions。schemaと本番APIの変更はない。

🟠 [Next] G0.3bの残るRecord／Review依存とMemoryの分割。その後G0.5のAsset保持・削除retry・孤児照合へ進む。

## English

🟢 [Done] Extracted synchronous and Worker import/export into independent integration cases. Coverage retains formats, partial/parse failures, idempotency conflict, rejection of approval bypass, draft-only imported Records, download and hash. Cleanup tracks returned jobs before assertions, requests cancellation and waits up to ten seconds before deleting generated data. A still-active job fails cleanup without deleting its data; object deletion failures remain visible and other cleanups continue. Records are rediscovered by Source even after an interrupted assertion sequence.

Validation: local unit suite 18 pass / 10 skip; real Docker integration suite 24 pass / 0 fail, 482 assertions. No production API or schema changes.

🟠 [Next] Finish Record/Review and Memory isolation, then G0.5 Asset retention, retryable deletion and orphan reconciliation.

## 简体中文

🟢 [Done] 将同步及Worker的Import／Export拆成独立集成测试，覆盖格式、部分失败、解析错误、幂等冲突、拒绝绕过审核、成功Record保持draft，以及下载和hash。断言前登记Job，清理时请求取消并最多等待10秒进入终态。仍在运行的Job会报告错误并保留数据；对象删除失败也会报告，其他清理继续执行。即使断言中途失败，也会按Source重新查找生成的Record。

验证：本地单元测试18通过／10跳过；真实Docker集成测试24通过／0失败，482次断言。未修改生产API或schema。

🟠 [Next] 完成Record／Review和Memory的测试拆分，再实施G0.5的Asset保留、可重试删除和孤立对象核对。
