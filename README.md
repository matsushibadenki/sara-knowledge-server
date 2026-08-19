# SARA Knowledge Server

AIの知識・経験・学習データをモデルの重みから切り離し、検証・修正・共有・継承できる形で保存するための知識基盤です。構造化データはPostgreSQL、バイナリアセットはMinIOを正本とし、LLM、SARA、将来のRISA、AI-data-managerなどが同じデータを利用できることを目指します。

> **English:** A PostgreSQL-based knowledge and memory server designed to preserve verifiable AI data, provenance, revisions, and reusable structures independently of any single model.
>
> **简体中文：** 一个以 PostgreSQL 为权威数据源的 AI 知识与记忆服务器，用于保存可验证的数据、来源、版本历史和可复用结构，并独立于任何单一模型。

現在はPhase 1の基盤実装中です。認証とRecord APIは動作しますが、Memory Schema、RISAの自己組織化、WordPress同期、完全な管理画面はまだ実装されていません。

## 成功の定義

このプロジェクトの成功は、大量のデータを保存することではありません。

```text
モデルを交換しても知識と経験が残る
誤りを一か所で修正し、以後の利用へ反映できる
回答や推論の出典・反例・変更履歴を追跡できる
同じ知識資産をLLM、SNN、SARA、RISAで再利用できる
```

Knowledge ServerはLLMのようにデータを重みへ学習するサーバーではなく、入力を失わずに取り込み、構造化・統合・検証し、学習や推論へ提供するサーバーです。

```text
入力
→ 原文・出典・不変Versionの保存
→ 構造化候補の生成
→ 既存知識との照合
→ 証拠・反例・文脈を含む検証
→ 承認済み知識または学習データとして提供
```

## 設計原則

### 構造化データはPostgreSQLを唯一の正本にする

WordPressや管理画面は入力・編集クライアントです。知識、学習データ、履歴、出典、評価の正本を複数システムへ分散させません。画像・音声・動画などのバイナリ本体はMinIOを正本とし、PostgreSQLから参照します。

### 原文・出典・履歴を失わない

Recordの更新では既存Versionを上書きせず、新しいVersionを追加します。削除も原則として論理削除とし、修正前の内容へ戻れるようにします。

### 候補と確定知識を分離する

LLM、ルール、SARA、RISAが生成した概念・関係・推論は、生成直後には事実として扱いません。生成元、エンジンのバージョン、証拠、反例、文脈、検証状態を保持し、承認後のみ確定知識へ昇格させます。

### 保存層と知能アルゴリズムを分離する

```text
SARA Knowledge Server
= 正本保存、版管理、出典、検索、検証、監査

SARA Engine / RISA
= 学習、活性化、構造照合、候補生成、推論、再編成
```

特定のLLMや学習アルゴリズムをKnowledge Serverへ固定せず、異なるエンジンの結果を比較・再評価できるようにします。

### 明示構造と自己組織化表現を併用する

RISAの将来設計では、人間が定義したKnowledge Graphだけに依存しません。

```text
学習・活性層
経験 → 再利用可能な局所Unit → Assembly → 高次Assembly

監査・交換層
Experience → Structure → Delta → Transformation
```

複数経験が同じ局所Unitを再利用した結果として、名前のない概念候補が形成されることを研究します。一方で、暗黙表現だけを正本にはせず、元経験、出典、Structure、型付きDelta、反例へ戻れる設計を維持します。

名前のないUnitは、頻出という理由だけで知識とみなしません。held-out予測、転移、圧縮、検索などへの再現可能な寄与と、交絡への耐性を評価します。

### 構造は正誤だけでなく安定性も検証する

構造候補を毎回高性能なVerifierだけで判定せず、再生時の予測誤差、共有部分の共鳴、排他的分岐の競合、恒常性、Event MemoryからのReplayを用いて低コストに支持度を更新します。

ただし、安定した構造が真実とは限りません。力学的安定性、独立した証拠、外部検証を別の尺度として保持し、高リスクな判断や事実確認では人間・ルール・外部資料を併用します。

## 関連プロジェクトとの責務

```text
AI-data-manager
= データ作成、編集、アノテーション、承認UI

SARA Knowledge Server
= データの正本、履歴、出典、検索、統合、検証

SARA Engine
= 学習、推論、イベント利用

RISA
= 将来の構造共有、自己組織化、構造編集、未知関係候補生成
```

本プロジェクトは、以下のプロジェクトから得た設計と資産を継承しながら独立したKnowledge Serverとして構築しています。

- [matsushibadenki/sara-engine-project](https://github.com/matsushibadenki/sara-engine-project)
- [matsushibadenki/AI-data-manager](https://github.com/matsushibadenki/AI-data-manager)

## アーキテクチャ

```text
AI-data-manager / Next.js / SARA / 外部サービス
                         │
                         ▼
                 SARA Knowledge API
                    Bun + Hono
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   PostgreSQL          Redis            MinIO
   正本・履歴        job・一時状態     binary asset
                         │
                         ▼
                    Worker / Engine
```

主要コンポーネント:

- `apps/api`: Bun + HonoによるREST API
- `apps/admin`: Next.jsによる管理画面。現在は多言語skeleton
- `apps/worker`: 非同期処理のskeleton
- PostgreSQL 16 + pgvector: 構造化データの正本
- Redis 7: ジョブ、キャッシュ、ログイン試行制限
- MinIO: 画像・音声・動画などのバイナリアセット
- Mailpit: 開発用メール確認

## 現在の実装状況

凡例:

- `[Done]` implemented in the current codebase
- `[Next]` high-priority unfinished work
- `[Later]` planned, but not the closest next step

### Phase 1

- [Done] Docker Composeによる開発環境
- [Done] PostgreSQL、Redis、MinIO、Mailpit
- [Done] Bun + Hono API、Next.js管理画面、Workerの基盤
- [Done] Drizzle ORM、migration、初期スキーマ
- [Done] `auth.users`、Refresh Token、APIキー
- [Done] JWTログイン、Refresh Tokenローテーション、logout
- [Done] APIキーのscope認可
- [Done] ユーザーロール認可とログイン試行回数制限
- [Done] Record CRUD、不変Version、同時更新制御
- [Done] Recordの論理削除・復元
- [Done] PostgreSQL、Redis、MinIOのreadiness確認
- [Done] 許可Origin方式のCORS
- [Done] 管理画面skeletonの日本語・英語・简体中文表示
- [Next] Source APIとRecordの出典登録フロー

### 将来設計

- [Later] アノテーション、品質評価、レビュー
- [Later] JSONL / JSON / CSVのインポート・エクスポート
- [Later] WordPress同期、HMAC、冪等性
- [Later] Event、Experience、Concept、Entity、Relation
- [Later] Structure、Delta、TransformationのMemory Schema
- [Later] 自己組織化Unit、residual、Assemblyの研究プロトタイプ
- [Later] 予測誤差・競合・恒常性・Replayによる構造検証
- [Later] 構造共有からの未知relation候補生成とheld-out評価
- [Later] 価値駆動学習、Research Queue、夜間バッチ
- [Later] バックアップ、復元、監査、負荷試験、本番化

詳細な進捗は[`docs/roadmap.md`](docs/roadmap.md)を参照してください。

## クイックスタート

### 必要なもの

- Docker DesktopまたはDocker Engine
- Docker Compose v2

BunやPostgreSQLなどをホストへ個別にインストールする必要はありません。

### 1. 環境変数を作成する

```bash
cp .env.example .env
```

少なくとも次の値を開発環境用に変更してください。

```dotenv
POSTGRES_PASSWORD=replace_with_a_password
MINIO_SECRET_KEY=replace_with_a_password
JWT_SECRET=replace_with_a_long_random_secret
ADMIN_PASSWORD=replace_with_at_least_12_characters
```

本番環境では`.env.example`の既定値を使用しないでください。

### 2. サービスを起動する

```bash
docker compose up -d --build
```

### 3. migrationを適用する

```bash
docker compose exec api bun run db:migrate
```

### 4. 管理者を作成する

```bash
docker compose exec api bun run db:seed
```

seedは`ADMIN_EMAIL`を一意キーとして冪等に実行できます。

### 5. 状態を確認する

```bash
docker compose ps
curl http://localhost:4000/health/ready
```

## アクセス先

- 管理画面: [http://localhost:3000](http://localhost:3000)
- API health: [http://localhost:4000/health](http://localhost:4000/health)
- API readiness: [http://localhost:4000/health/ready](http://localhost:4000/health/ready)
- OpenAPI JSON: [http://localhost:4000/openapi.json](http://localhost:4000/openapi.json)
- MinIO Console: [http://localhost:9001](http://localhost:9001)
- Mailpit: [http://localhost:8025](http://localhost:8025)

ホスト側の主要ポートは`.env`の`ADMIN_PORT`、`API_PORT`、`POSTGRES_PORT`、`REDIS_PORT`などで変更できます。現在のCompose構成では、サービス間接続に使うMinIOの内部ポートは`9000`のまま使用してください。

## 現在利用できるAPI

基本URLは`http://localhost:4000/api/v1`です。

```text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
GET    /auth/api-keys
POST   /auth/api-keys
DELETE /auth/api-keys/:id

GET    /records
POST   /records
GET    /records/:id
PATCH  /records/:id
DELETE /records/:id
POST   /records/:id/restore
GET    /records/:id/versions
```

JWTアクセストークンまたは`sara_`プレフィックスのAPIキーをBearer Tokenとして送信します。Record更新では競合検出のため`expected_version`が必要です。

```text
Authorization: Bearer <JWT or sara_API_KEY>
```

認証とRecord形式の詳細:

- [`docs/authentication.md`](docs/authentication.md)
- [`docs/records.md`](docs/records.md)

## テスト

基本テスト:

```bash
docker compose exec api bun test
```

PostgreSQL、Redis、migration、管理者seedを利用する統合テスト:

```bash
docker compose exec -e RUN_INTEGRATION=1 api bun test
```

統合テストを実行する前に、migrationと管理者seedを完了してください。

## 運用コマンド

ログを確認する:

```bash
docker compose logs -f
```

停止する:

```bash
docker compose down
```

Volumeを含めて削除する:

```bash
docker compose down -v
```

`down -v`はPostgreSQL、Redis、MinIOの永続データを削除します。

## ディレクトリ

```text
apps/api       API、認証、DB Schema、migration、テスト
apps/admin     Next.js管理画面
apps/worker    非同期ジョブワーカー
docker/        PostgreSQLなどの初期化
docs/          設計、研究仮説、重要な決定、進捗
packages/      将来の共有パッケージ
```

## 主要ドキュメント

- [全体設計書](docs/sara-knowledge-server設計書.txt)
- [ドキュメント索引](docs/README.md)
- [ロードマップ](docs/roadmap.md)
- [成功基準](docs/success-criteria.md)
- [知識獲得・構造化・統合モデル](docs/knowledge-acquisition-and-learning-model.md)
- [構造共有による知識創発](docs/structural-knowledge-emergence.md)
- [Structure・Delta・Transformation記憶モデル](docs/structure-delta-transformation-memory.md)
- [自己組織化する共有表現](docs/self-organizing-shared-representations.md)
- [力学的な構造検証](docs/dynamical-structural-validation.md)

重要な設計判断は、会話内だけに残さず`docs/`へ保存します。実装と将来設計に差がある場合は、ドキュメント内で`[Done]`、`[Next]`、`[Later]`または「将来候補」として区別します。

## ライセンス

ライセンスはまだ確定していません。外部データを登録するときは、データごとの出典とライセンス条件を保持してください。
