# Snapshotの影響照会 / Snapshot impact / 快照影响

🟢 [Done] `GET /api/v1/datasets/:id/snapshots/:snapshotId/impact` は固定済みRecord Versionと現在のSourceの状態を比較する。理由は `source_revised`、`source_withdrawn`、`legacy_unknown`。ページ送りは `limit` と `after_ordinal`。DatasetとSourceの読取権限が必要。既存Snapshotのメンバーとmanifestは不変。

新規manifest 1.2は、選定ポリシー `dataset-selection/1`、既存の出典版参照、作成時点でRecordまたは固定出典に紐付いたready AssetのID・SHA-256・サイズ・MIME・役割を保存する。Assetの紐付けはSnapshot作成時の状態を表す。Sourceの過去版作成時点の紐付けは復元できない。原本の取得・検証は後続の再現バンドルで扱う。

隔離PostgreSQL、Redis、MinIOで全migrationとDataset／Training統合試験が成功。訂正、撤回、ページ送り、Assetの紐付け解除後もmanifestで参照が残ることを検証した（71アサーション）。

English. Snapshot impact identifies revised or withdrawn sources and legacy unknown provenance. New manifests freeze the selection policy and record ready Asset identity and hashes at Snapshot creation. Original file export remains follow-up work.

简体中文。快照影响接口标明已经订正、撤回的来源及未知的旧版来源。新清单固定筛选规则的版本，并记录创建时已就绪资产的标识和哈希。原始文件的导出为后续工作。

🟢 [Done] migration 0034以降に作成するSnapshotは、Asset保持参照をメンバーと同じトランザクションで保存する。Asset行の共有ロックは削除処理の排他ロックと競合するため、削除とSnapshot登録が互いにすり抜けない。元の紐付けを外しても、削除APIは `ASSET_SNAPSHOT_IN_USE` を返す。削除Workerと照合処理も保持参照を確認する。確認済みのmanifest生成失敗は参照を解除する。処理中断で構築中のまま残った場合は原本を保持する。

既存Snapshotはmanifestに記録されたAssetの現在の状態を推測できないため、このmigrationでは保持参照を遡って追加しない。

English. New Snapshots retain their referenced Asset originals even after attachment removal. Confirmed build failures release the pins. Interrupted builds retain them. Existing Snapshots are not backfilled.

简体中文。新快照即使解除原有绑定，也会保留引用资产的原始文件。确认构建失败时释放保留引用，中断的构建继续保留。迁移不会回填旧快照。
