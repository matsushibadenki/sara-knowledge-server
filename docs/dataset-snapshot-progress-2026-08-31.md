# Dataset Snapshot実装記録 — 2026-08-31

## 到達した節目

- [Done] `dataset.dataset_definitions`を追加
- [Done] `dataset.dataset_snapshots`を追加
- [Done] `dataset.dataset_snapshot_records`を追加
- [Done] Definition作成・一覧・取得・変更API
- [Done] status、record type、language、minimum qualityによる抽出
- [Done] Record UUID順の決定的なmember固定
- [Done] Record更新後も変わらないVersion参照
- [Done] JSON／JSONL manifestのMinIO保存
- [Done] manifest SHA-256の保存・download header照合
- [Done] scope・role・作成者境界
- [Done] 10,000 Recordの同期処理上限

## 実装判断

Definitionは再利用のため変更可能、Snapshotは実験再現のため不変とした。Recordの現在版IDだけをmanifest生成時に読む方式では、後日のRecord更新により学習入力が変わるため、Snapshot memberへ正確なRecord Version IDを保存する。

DB整合性を保つ処理と外部object storage処理を分離した。対象Versionの選択とSnapshot member固定は一つの短いトランザクションで完了し、MinIO書き込みはcommit後に行う。外部保存に失敗した場合はSnapshotを削除せず`failed`として追跡できる。

## 検証

- migration `0013_wonderful_lady_bullseye.sql`をDocker PostgreSQLへ適用
- Definition名重複が409になることを確認
- scope不足APIキーが403になることを確認
- 3 RecordのSnapshot生成とmanifest取得を確認
- Snapshot後に元Recordを更新し、SnapshotのVersion IDとmanifestが旧Versionを維持することを確認
- 基本テスト: 9 pass、1 integration skip、19 assertions
- Docker統合テスト: 10 pass、208 assertions、0 failures
- `auth`／`dataset`／`system` schemaの外部キー索引漏れ: 0件
- API readiness: HTTP 200
- `git diff --check`: 問題なし

## 次の節目

- [Done] Training Run・Snapshot利用履歴・評価結果の追跡
- [Done] Event・Experience・Entity・Concept・Relationの最小Memory Schema
- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Next] Bulk Event ingestion・bounded graph traversal
- [Later] Dataset split、大規模非同期build、モデル仕様に応じた変換器
