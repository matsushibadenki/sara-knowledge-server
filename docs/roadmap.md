# Roadmap

## Phase 1: 基盤

- [Done] monorepoの初期構成
- [Done] Docker Composeサービス定義
- [Done] PostgreSQL + pgvector + pgcrypto + pg_trgm + unaccent
- [Done] Redis
- [Done] MinIOと初期バケット作成
- [Done] Mailpit
- [Done] Bun + Hono API skeleton
- [Done] Next.js管理画面 skeleton
- [Done] Worker skeleton
- [Done] API liveness / health / readinessの入口
- [Done] OpenAPI skeleton
- [Done] Bun APIの基本テスト
- [Done] READMEと環境設定例

## 次の実装

- [Done] Drizzle ORM、スキーマ、migration基盤
- [Done] `auth.users`、`dataset.sources`、`dataset.records`、`dataset.record_versions`の初期テーブル
- [Done] `auth.users` の管理者seed
- [Done] ログイン、JWTアクセストークン、認証middleware
- [Done] Refresh TokenのDB保存・ローテーション・logout
- [Done] APIキーの発行・一覧・失効・scope保存
- [Next] APIキーによるリクエスト認証とscope認可
- [Done] Record CRUD、版履歴、論理削除、復元
- [Done] APIのDB / Redis / MinIO readiness実接続確認

## 将来の実装

- [Later] アノテーション、タグ、評価
- [Later] JSONL / JSON / CSVインポート・エクスポート
- [Later] データセット生成と品質管理
- [Later] イベント、経験、概念、実体、関係
- [Later] RISA / SARA Engine連携
- [Later] WordPress同期、HMAC、冪等性
- [Later] ベクトル検索、価値駆動学習、Research Queue
- [Later] フィードバック駆動の構造更新と予測誤差の監査
- [Later] バックアップ、復元、監査、負荷試験、本番化
