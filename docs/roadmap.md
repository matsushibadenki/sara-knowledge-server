# Roadmap

## Phase 1: 基盤

- [Done] monorepoの初期構成
- [Done] Docker Composeサービス定義
- [Done] PostgreSQL + pgvector + pgcrypto + pg_trgm + unaccent + citext
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
- [Done] APIキーによるリクエスト認証とscope認可
- [Done] ロール認可とログイン試行回数制限
- [Done] Source API、論理削除・復元、検索、scope認可
- [Done] Recordの出典関連付け、参照先検証、削除後のprovenance保持
- [Done] Record CRUD、版履歴、論理削除、復元
- [Done] Record現在版の外部キー・版番号一意制約・同時更新制御
- [Done] Record / Version / Refresh Token / APIキーの初期インデックス
- [Done] Source種別のDB制約とSource検索用インデックス
- [Done] APIのDB / Redis / MinIO readiness実接続確認
- [Done] 許可Origin方式のCORS
- [Done] 管理画面skeletonの日本語・英語・简体中文表示
- [Done] lockfile固定のDocker build

## 将来の実装

- [Next] Source・Record変更の監査ログ
- [Later] アノテーション、タグ、評価
- [Later] JSONL / JSON / CSVインポート・エクスポート
- [Later] データセット生成と品質管理
- [Later] イベント、経験、概念、実体、関係
- [Later] RISA / SARA Engine連携
- [Later] WordPress同期、HMAC、冪等性
- [Later] ベクトル検索、価値駆動学習、Research Queue
- [Later] フィードバック駆動の構造更新と予測誤差の監査
- [Later] 構造パターン・適用事例・類似構造のMemory Schema
- [Later] Structure snapshot・型付きDelta・checkpointのMemory Schema
- [Later] 類似DeltaからTransformation Patternを抽出
- [Later] MDLによる基底構造・差分・例外の表現比較
- [Later] 構造共有による未知relation候補生成とheld-out評価
- [Later] Structural Factorization用toy domainとheld-out composition benchmark
- [Later] 人間定義Primitiveと学習Factorによる分解・再構成baseline比較
- [Later] top-k分解候補と制約付きFactor／Transformation合成探索
- [Later] 構造合成推論と検索・RAG・graph traversal・LLMの比較
- [Later] 10³→10⁵→10⁷ Factor候補の段階的scale試験
- [Later] Factorization・Composition Proposal・Reasoning TraceのMemory Schema
- [Later] 共通潜在過程を文章・animation・音記号・触覚時系列へ描画するtoy dataset
- [Later] native値・modality固有構造・cross-modal Factor・residualの最小表現
- [Later] modality別・shared Embedding・typed Factorのcross-modal baseline比較
- [Later] held-out modality pair・hard negative・alignmentずれ・leakage耐性評価
- [Later] Factor applicability profileとcross-modal transfer evaluation
- [Later] alignment・modality binding・transfer履歴のMemory Schema
- [Later] 局所Unit再利用・residual・Assembly形成の自己組織化プロトタイプ
- [Later] 名前のないlatent Unitの安定性・予測利得・交絡耐性評価
- [Later] 自己組織化共有表現から監査用Structure／Deltaへの投影
- [Later] 予測誤差・競合・恒常性による構造Stability Profile
- [Later] Event Memoryからのsandbox Replayと段階的consolidation
- [Later] 力学的検証とLLM Verifierの精度・費用比較
- [Later] Spectral NeuronをStability／Value scorerとして単純baselineと比較
- [Later] eigengap・基底不変量によるlatent表現の説明安定性評価
- [Later] top-k局所波及、減衰、導出履歴、回帰時取消
- [Later] バックアップ、復元、監査、負荷試験、本番化
