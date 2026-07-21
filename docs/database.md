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

PostgreSQLの初期化時に以下を有効化する。

- `pgcrypto`
- `vector`
- `pg_trgm`
- `unaccent`
- `citext`

## 設計上の注意

- `records`は論理的な親レコードを保持する
- `record_versions`は本文の履歴を保持し、既存バージョンを上書きしない
- `records.current_version_id`は現在版への参照として予約している
- 現在版の一意性・更新処理はRecord service実装時にトランザクションで保証する
- `sources`は出典・ライセンス・取得情報を保持する
- APIでは連番IDを公開せず、UUIDを使用する

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

- 管理者seed
- status / role / record_typeのSchema検証
- Record serviceの作成・版追加・論理削除・復元
- 現在版参照の整合性
- 一覧検索用インデックス
- 監査ログ
