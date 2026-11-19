# Source版とRecord出典固定 / Source revision pins / Source版本固定

2026-11-19

🟢 [Done] G1の最初の項目を実装。migration `0029_tan_unicorn.sql` は、Sourceの属性・論理削除・復元の変更を単調増加するrevisionとJSON snapshotへ保存する。updated_atのみの変更や同じ属性の再送では版を増やさない。Source行と履歴は同一transactionで確定し、履歴の直接UPDATE／DELETEを拒否する。物理Source削除によるcascadeはfixture／管理作業用に許可するが、Record Versionの出典版FKが残っていれば削除できない。

Record Versionには `source_id`、`source_revision`、`source_pin_state`、`context_snapshot` を追加。初回VersionはDB triggerでSourceの現行版へ固定し、API・同期Import・実Workerに同じ規則を適用する。title、record_type、language_code、metadata、quality_score、confidenceもVersionごとに保持する。通常のRecord PATCHは出典版を継承する。同じIDであっても `source_id` を明示したPATCHは、Sourceをshare lockして現行版へ再固定する。nullなら出典を解除する。本文編集に伴い出典が暗黙に最新版へ切り替わることはない。

## API

- Source応答に `revision` を追加。
- PATCH `/api/v1/sources/:id` に任意の `expected_revision` を追加。不一致は409 `REVISION_CONFLICT`。旧クライアント互換のため省略は可能であり、省略時は競合検知を保証しない。
- GET `/api/v1/sources/:id/revisions?page=1&limit=20` と GET `/api/v1/sources/:id/revisions/:revision` を追加。認証、workspace membership、`sources:read`、既存の読取roleが必要。論理削除後も履歴を参照できる。
- Recordの `current_version` と `/versions` で出典pinとcontextを返す。互換性のためRecord応答直下の `source` は引き続き最新Sourceを返す。過去の出典には必ずVersionのpinを使う。
- 新しいDataset manifestは `sara.dataset-manifest/1.1`。Versionのcontextと出典pinを格納。既存manifestは変更しない。

## 移行と検証

移行時点のSource属性は `origin=migration_baseline` として保存する。移行前のRecord Versionは `source_pin_state=legacy_unknown`、出典版とcontextはnullのままにし、当時の状態を推測しない。旧Versionから作る新Versionも、出典を明示して再固定するまでは不明状態を継承する。

- `bun test`: 29 pass、18 skip、0 fail（統合試験はDockerで別途実施）。
- 隔離PostgreSQL／Redis／MinIO／実WorkerでAPI suite: 32 pass、2 skip、0 fail。Source競合、履歴の改変拒否、Record編集時のpin継承／再固定、論理削除後の参照、同期／非同期Import、新旧Snapshotの不変性を確認。
- `bun scripts/test-source-revision-upgrade.js`: migration 28までのDBへ旧Source／Recordを投入し、dump取得後にmigration 29を適用。別DBへ移行前dumpを復元して再migrationし、不明状態の保持、baseline保持、新Recordの版固定を確認。CIにも追加。
- 隔離環境で `bun scripts/test-coordinated-backup.js`: Source履歴を含む39 tablesと6 objectsを別DB／MinIOへ復元し、内容hash・参照・object hashを照合する。
- `bun run --cwd apps/api db:generate`: schema差分なし。生成snapshotと手書きtriggerを一つのmigrationに保存。

テストは通常の開発DBへ触れず、専用Compose projectとvolumeで実行した。新migrationを本番へ適用したという意味ではない。

🟠 [Next] Memory Evidenceの参照revision固定と独立Source／重複証拠の区別。Source訂正から依存先の自動失効へはまだ接続していない。

🔴 [Later] Import Jobの受付時点での出典固定、Exportへのpinを含む再現bundle、Source／Asset／policy版をまとめた完全再現。今回保存するのはSourceのDB属性であり、外部URLの過去本文を取得・保存する機能ではない。

⭕️ [Pending] 本番provider、別物理host、実データ量でのmigration／restoreとRPO／RTO。

## English

Source changes now create immutable revision snapshots atomically. Each new Record Version pins its source revision and freezes interpretation metadata. Ordinary edits preserve the pin; explicitly supplying source_id rebinds to the current revision, and null detaches it. Optional expected_revision detects concurrent Source updates; omitting it retains legacy last-write behavior. Authenticated history endpoints require existing source-read access. New Dataset manifests use format 1.1 and include the version context and source pin. The Record response's top-level source still represents the latest Source.

Legacy Record provenance remains explicitly unknown; migration-time Source snapshots are marked migration_baseline. Tested an old-schema upgrade, pre-upgrade dump restoration and re-upgrade, real Worker imports and Snapshot immutability. Evidence pinning and automatic dependency invalidation are next; URL contents and a complete source/asset/policy bundle are not included. Production and off-host validation remain pending.

## 简体中文

Source修改在同一事务中生成不可变版本快照。新Record Version固定Source版本，并冻结解释所需的属性。普通编辑保留原出典版本；显式提供source_id时绑定现行版本，null表示解除绑定。可选expected_revision用于检测并发修改，省略时保留旧版的最后写入行为。历史API沿用认证、workspace与Source读取权限。新Dataset manifest使用1.1格式，保存版本context和出典引用；Record顶层source仍表示最新Source。

旧Record的历史出典明确标为未知；迁移时的Source快照标为migration_baseline。已验证旧schema升级、迁移前dump恢复及再次升级、真实Worker导入与Snapshot不变性。下一步是Evidence版本固定和依赖失效；未包括外部URL历史正文或完整Source／Asset／policy再现bundle。生产和其他物理主机验证仍为Pending。
