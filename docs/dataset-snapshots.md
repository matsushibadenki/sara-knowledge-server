# Dataset Definitionと不変Snapshot

## 目的

Dataset Definitionは、学習対象を選ぶ条件を再利用可能な名前付き定義として保存する。Snapshotは、その条件に一致したRecordの「作成時点のVersion」を固定し、将来RecordやDefinitionが更新されても同じ学習入力を再現できるようにする。

```text
Dataset Definition（変更可能）
        │ build
        ▼
Dataset Snapshot（不変）
        ├── frozen filters
        ├── definition revision
        ├── ordered Record Version IDs
        └── JSON / JSONL manifest + SHA-256
```

English: A mutable Dataset Definition stores reusable selection rules. An immutable Snapshot freezes the exact ordered Record Versions and a checksummed manifest used by training or evaluation.

简体中文：可修改的 Dataset Definition 保存可复用的筛选条件；不可变 Snapshot 固定有序的 Record Version，并生成带 SHA-256 的训练清单。

## 対応するfilter

- `statuses`
- `record_types`
- `language_codes`
- `minimum_quality_score`

論理削除済みRecordは常に除外する。並び順はRecord UUIDの昇順で固定する。同期buildの上限は10,000 Recordとし、大規模buildは将来Workerへ移す。

## API

```text
GET    /api/v1/datasets
POST   /api/v1/datasets
GET    /api/v1/datasets/:id
PATCH  /api/v1/datasets/:id

GET    /api/v1/datasets/:id/snapshots
POST   /api/v1/datasets/:id/snapshots
GET    /api/v1/datasets/:id/snapshots/:snapshotId
GET    /api/v1/datasets/:id/snapshots/:snapshotId/manifest
```

Definitionの読み取りには`datasets:read`、作成・変更・Snapshot buildには`datasets:write` scopeを要求する。現段階ではDefinitionとSnapshotは作成者に限定して公開する。

## 不変条件

- Definitionは変更可能だが、作成済みSnapshotへ変更を波及させない。
- Snapshotは`definition_revision`とfilterの複製を保持する。
- Snapshot memberはRecordだけでなく、作成時点の`record_version_id`を保持する。
- 対象Versionの選択、Snapshot行、member行の保存は短い同一DBトランザクションで行う。
- MinIOへのmanifest保存中はDBトランザクションを保持しない。
- manifest保存成功時だけSnapshotを`completed`にし、失敗時は`failed`とエラーを残す。
- manifest本文のSHA-256をDBとdownload response headerへ保存する。
- Snapshot削除・member変更APIは提供しない。

## manifest

Schema identifierは`sara.dataset-manifest/1.0`とする。JSONはmetadataと`records`配列、JSONLは先頭に`type=manifest`、以降に`type=record`を出力する。

各memberには少なくとも以下を含める。

```text
ordinal
record_id
record_version_id
version_number
record_type
status
language_code
quality_score
confidence
source_id
schema_version
```

manifestは本文そのものを複製せず、正確なVersionを参照する学習入力契約として扱う。実際の学習データ変換は、Snapshotと変換器のVersionを組み合わせて行う。

## 次の実装

- [Done] Dataset Definition CRUD
- [Done] filterによる現在Versionの選択
- [Done] 不変Snapshotと順序付きmember固定
- [Done] JSON／JSONL manifest、MinIO保存、SHA-256
- [Done] Snapshot作成後のRecord更新に対する再現性テスト
- [Done] Training Runが使用したSnapshot、変換器、モデル、設定、結果の追跡
- [Done] Event・Experience・Entity・Concept・Relationの最小Memory Schema
- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Next] Bulk Event ingestion・bounded graph traversal
- [Later] split、10,000件超の非同期build、モデル別変換器
