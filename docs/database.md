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
- APIでは連番IDを公開せず、UUIDを使用する
- Record、Version、Refresh Token、APIキーの主要検索条件にはインデックスを設定する

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
- [Next] Source APIとRecordの出典登録フロー
- [Later] 監査ログ

## 将来のMemory Schema

Structure、型付きDelta、Transformation Patternは設計採用済みだが、現在のmigrationにはまだ追加しない。出典追跡と監査の基盤を先に完成させる。

将来スキーマと責務分離は、`structure-delta-transformation-memory.md`および`sara-knowledge-server設計書.txt`の8.13〜8.17を正とする。
