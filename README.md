# SARA Knowledge Server

PostgreSQLを正本とする、AI学習データ・イベント記憶・概念・関係データの管理サーバーです。

## Phase 1

現在は実装基盤を構築しています。

- [Done] Docker Composeのサービス定義
- [Done] PostgreSQL / pgvector / Redis / MinIO / Mailpit
- [Done] Bun API skeleton
- [Done] Next.js管理画面 skeleton
- [Done] Worker skeleton
- [Done] API healthcheckとOpenAPI skeleton
- [Next] Drizzle migrationと初期スキーマ
- [Next] 認証と管理者seed
- [Later] Record CRUDとバージョン管理

## 起動

```bash
cp .env.example .env
docker compose up -d --build
```

アクセス先:

- 管理画面: http://localhost:3000
- API: http://localhost:4000/health
- OpenAPI: http://localhost:4000/openapi.json
- MinIO Console: http://localhost:9001
- Mailpit: http://localhost:8025

停止:

```bash
docker compose down
```

データを含めて削除する場合:

```bash
docker compose down -v
```

## ディレクトリ

```text
apps/api      Bun + Hono API
apps/admin    Next.js管理画面
apps/worker   非同期ジョブワーカー
docker/       PostgreSQLなどの初期化
docs/         設計・調査・重要な決定事項
```

## 言語対応

管理画面は日本語を初期表示とし、英語・简体中文を追加できる構成をPhase 2以降で整備します。

