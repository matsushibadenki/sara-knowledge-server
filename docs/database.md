# Database

2026-09-05: 実装順序は[現行Roadmap](roadmap.md)、改訂方針は[設計評価](database-direction-review-2026-09-05.md)を参照する。以下は現行schemaの説明であり、Source／Memory／Evidenceの完全な版固定や本番復旧保証が実装済みという意味ではない。

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
- `auth.api_request_nonces`

### `dataset`

- `dataset.sources`
- `dataset.assets`
- `dataset.asset_bindings`
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
- `dataset.dataset_definitions`
- `dataset.dataset_snapshots`
- `dataset.dataset_snapshot_records`

### `system`

- `system.audit_logs`

### `training`

- `training.models`
- `training.runs`
- `training.metrics`

### `memory`

- `memory.experiences`
- `memory.events`
- `memory.event_ingestion_batches`
- `memory.event_ingestion_jobs`
- `memory.entities`
- `memory.concepts`
- `memory.relations`
- `memory.entity_aliases`
- `memory.relation_evidence`
- `memory.verification_decisions`

Experience、Event、Entity、Entity Alias、Concept、Relationは楽観的競合制御用の`revision`を持つ。Verification Decisionは判断対象を後から復元できるように`target_revision`と`target_snapshot`を保持する。Migration前のlegacy Decisionでは内容を推測せず、snapshotを空objectとして移行する。

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
- 非同期Jobはclaim時に世代と試行回数を増やし、heartbeatでleaseを延長する。定期reaperは期限切れleaseだけを再queueし、進捗・完了・失敗はworker IDとclaim世代が一致する場合だけ確定する
- Redisは起床通知に限定し、接続不能・timeout時もPostgreSQLの`SKIP LOCKED` pollingを継続する。Import／Export／Memory Eventはround-robinでclaimする
- Dataset Definitionは再利用可能な抽出条件とmanifest形式を保持する
- Dataset Snapshotは作成時点のDefinition revision、filter、Record Version、順序を固定する
- Snapshot作成後にRecordの現在版やDefinitionを変更しても、既存Snapshotの構成は変更しない
- Snapshotのメンバー選択と固定は短い同一トランザクションで行い、MinIOへのmanifest保存はトランザクション外で行う
- 同期Snapshotは10,000 Recordを上限とし、より大きいbuildは将来のWorker処理へ分離する
- Model Registryは変更可能だが、Training Runは作成時点のModel定義を`model_snapshot`へ固定する
- Training Runは完成済みの所有Dataset Snapshotだけを参照する
- Run statusとstarted／finished timestampの組み合わせはDB CHECK制約で保証する
- Run状態遷移は更新前statusを条件に含め、同時遷移を競合として拒否する
- Metricは追記型とし、Run・metric name・split・stepを一意にする
- Memory nodeは作成者内UIDを一意にし、通常検索は論理削除されていない行だけを対象にする
- EventはSourceとExperienceをFK参照し、各外部キーを索引化する
- EntityとConceptはSource provenance、proposal source、verification stateを保持する
- Relation node typeはDB CHECK、参照先存在・所有者・有効状態はサービス層で検証する
- Relationのincoming／outgoing検索にはactive行だけの部分複合索引を使用する
- Entity AliasはNFKC等で正規化し、Entity・language・normalized aliasを有効行内で一意にする
- Relation Evidenceは追記型とし、追加とRelation count更新を同一トランザクションで行う
- Verification Decisionは追記型とし、対象状態の条件付き更新と同一トランザクションで保存する
- verification stateの明示変更は通常PATCHで拒否し、検証専用APIを使う（JWTはreviewer/admin、API keyは`memory:verify` scope）。ただし内容変更時にも既存状態が残るため、内容版への検証固定はG0の修復対象

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
- [Done] Dataset Definition・不変Snapshot・manifest Schema
- [Done] Training Run・Snapshot利用履歴・評価結果Schema
- [Done] Event・Experience・Entity・Concept・Relationの最小Memory Schema
- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Done] Bulk Event ingestion・bounded graph traversal
- [Done] SARA／external Worker HTTPS ingestion・HMAC署名・replay protection
- [Done] Queue-backed asynchronous Event ingestion for 501〜10,000 events
- [Done] Asset API・upload authorization・provenance binding
- [Done] Record参照とworkspace境界、承認／revision整合性の修復
- [Done] Worker lease／heartbeat／claim世代、上限付きretry、定期reaper、Redis停止時polling
- [Next] Asset確定・参照保持、DB＋object backup／restore試験
- [Later] Asset processing jobs・media metadata extraction・derived-Asset provenance

## 将来のMemory Schema

Structure、型付きDelta、Transformation Pattern、自己組織化する共有Unit、力学的なStability ProfileとReplay履歴は研究候補として保持し、効果を確認するまで現在のmigrationには追加しない。Asset本体をobject storage、metadataとSource／Record／Event bindingをPostgreSQLで管理できる。media metadata抽出とderived AssetのprovenanceはG4へ延期し、先に既存知識の整合性を修復する。

StructureとDeltaの将来スキーマは`structure-delta-transformation-memory.md`、共有Unitの実験設計は`self-organizing-shared-representations.md`、動的検証は`dynamical-structural-validation.md`を参照する。UnitとStability関連スキーマはtoy experimentで有効性を確認してから確定する。
