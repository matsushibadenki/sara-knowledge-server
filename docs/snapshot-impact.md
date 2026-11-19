# Snapshotの影響照会 / Snapshot impact / 快照影响

🟢 [Done] `GET /api/v1/datasets/:id/snapshots/:snapshotId/impact` は固定済みRecord Versionと現在のSourceの状態を比較する。理由は `source_revised`、`source_withdrawn`、`legacy_unknown`。ページ送りは `limit` と `after_ordinal`。DatasetとSourceの読取権限が必要。既存Snapshotのメンバーとmanifestは不変。

新規manifest 1.2は、選定ポリシー `dataset-selection/1`、既存の出典版参照、作成時点でRecordまたは固定出典に紐付いたready AssetのID・SHA-256・サイズ・MIME・役割を保存する。Assetの紐付けはSnapshot作成時の状態を表す。Sourceの過去版作成時点の紐付けは復元できない。Assetの原本取得と保持は後続の再現バンドルで扱う。

隔離PostgreSQL、Redis、MinIOで全migrationとDataset／Training統合試験が成功。訂正、撤回、ページ送り、Assetの紐付け解除後もmanifestで参照が残ることを検証した（71アサーション）。

English. Snapshot impact identifies revised or withdrawn sources and legacy unknown provenance. New manifests freeze the selection policy and record ready Asset identity and hashes at Snapshot creation. Original file retention and export remain follow-up work.

简体中文。快照影响接口标明已经订正、撤回的来源及未知的旧版来源。新清单固定筛选规则的版本，并记录创建时已就绪资产的标识和哈希。原始文件保留与导出为后续工作。
