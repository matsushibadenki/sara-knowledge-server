# Database

## 現在の実装

Drizzle ORM + postgres.jsを使用し、PostgreSQLを正本とする。

migrationは以下に保存されている。

```text
apps/api/src/db/migrations/
```

migrationの履歴はDrizzle管理テーブルへ保存する。

```text
drizzle.__drizzle_migrations
```

## 初期スキーマ

### `auth`

- `auth.users`
- `auth.refresh_tokens`
- `auth.api_keys`

### `dataset`

- `dataset.sources`
- `dataset.records`
- `dataset.record_versions`
- `dataset.tags`
- `dataset.record_tags`
- `dataset.annotations`
- `dataset.evaluations`
- `dataset.record_reviews`
- `dataset.import_jobs`
- `dataset.import_items`
- `dataset.export_jobs`

### `system`

- `system.audit_logs`

### 拡張

PostgreSQLの初期化時と冪等migrationで以下を有効化する。既存volumeにもmigrationで不足分を追加する。

- `pgcrypto`
- `vector`
- `pg_trgm`
- `unaccent`
- `citext`

## 設計上の注意

- `records`は論理的な親レコードを保持する
- `record_versions`は本文の履歴を保持し、既存バージョンを上書きしない
- `records.current_version_id`は外部キーで現在版を参照する
- `(record_id, version_number)`は一意であり、同じRecordに同じ版番号を重複作成できない
- `is_current = true`の有効なVersionはRecordごとに1件だけ許可する
- Record更新では親Recordを行ロックし、`expected_version`の比較とVersion追加を同一トランザクションで行う
- `sources`は出典・ライセンス・取得情報を保持する
- Sourceの`source_type`はAPIとDB CHECK制約の両方で検証する
- 新しいRecord関連付けでは論理削除されていないSourceだけを許可し、既存Recordの出典参照はSource論理削除後も保持する
- APIでは連番IDを公開せず、UUIDを使用する
- Record、Version、Source、Refresh Token、APIキーの主要検索条件にはインデックスを設定する
- Source／Recordの変更と監査INSERTは同じトランザクションで完了させる
- 監査ログは本文を複製せず、親属性、Version識別子、変更field、metadataキーだけを保持する
- 監査の主検索経路には`resource_type + resource_id + created_at`などの複合索引を設定する
- Annotation、Evaluation、Reviewは対象Recordと固定されたRecord Versionの両方を参照する
- Review待ちはRecordごとに1件だけとし、部分一意索引で競合を防ぐ
- Review Queueはpending行だけを含む部分索引を使用する
- Review中のRecordは更新・削除を拒否し、判定対象Versionを固定する
- Import Jobは原文、SHA-256、形式、冪等キー、件数を保持する
- Import Itemは行番号ごとのRecordまたは検証エラーを保持し、部分成功を追跡する
- 完了したImportの`total_count`は成功数と失敗数の合計に一致させる
- 同一作成者の冪等キーは一意で、異なるchecksumによる再利用を拒否する
- Export Jobはfilter、件数、byte数、SHA-256を保存する
- 非同期Jobは`queued → processing → completed|failed|cancelled`で遷移する
- Worker claim対象だけを含む部分索引を使用し、`FOR UPDATE SKIP LOCKED`で複数Workerの競合待ちを避ける
- MinIO object key、worker ID、開始時刻、処理済み件数、取消要求をJobへ保存する
- 5分以上古いprocessing JobはWorker起動時にqueuedへ戻し、既存Import Itemの最大行から再開する

## コマンド

APIディレクトリで実行する。

```bash
bun run db:generate
bun run db:migrate
```

Docker環境では以下を使用する。

```bash
docker compose exec api bun run db:migrate
```

## 次のDB実装

- [Done] 管理者seed
- [Done] status / record_typeのAPI Schema検証
- [Done] Record serviceの作成・版追加・論理削除・復元
- [Done] 現在版参照、版番号、現在版一意性の整合性
- [Done] 初期一覧検索用インデックス
- [Done] user status / roleのCHECK制約と初期権限モデル
- [Done] Source APIとRecordの出典登録フロー
- [Done] Source・Record変更の監査ログ
- [Done] アノテーション・タグ・評価の最小スキーマ
- [Done] Record Version固定のレビュー申請・判定・待ち行列
- [Done] 同期Import／Exportジョブと原文・行別結果スキーマ
- [Done] MinIO Asset参照、Redis通知、非同期Worker処理
- [Next] Dataset Definition・Snapshot・manifest Schema

## 将来のMemory Schema

Structure、型付きDelta、Transformation Pattern、自己組織化する共有Unit、力学的なStability ProfileとReplay履歴は設計採用済みだが、現在のmigrationにはまだ追加しない。出典追跡、監査、データ品質、レビューの最小基盤は完成したため、次に一括取り込みと出力を実装する。

StructureとDeltaの将来スキーマは`structure-delta-transformation-memory.md`、共有Unitの実験設計は`self-organizing-shared-representations.md`、動的検証は`dynamical-structural-validation.md`を参照する。UnitとStability関連スキーマはtoy experimentで有効性を確認してから確定する。
