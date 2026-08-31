# Import／Export

## 目的

AI-data-managerや外部ツールが作成したJSON、JSONL、CSVを、出典・原文・行別結果を失わずRecordへ取り込み、現在版を再利用可能な形式で出力する。

> **English:** The synchronous API imports JSON, JSONL, and CSV with idempotency, checksums, per-row outcomes, and partial success. It exports current Record versions with reproducible metadata and a SHA-256 digest.
>
> **简体中文：** 同步API支持导入JSON、JSONL和CSV，并保存幂等键、校验和、逐行结果及部分成功状态；导出当前记录版本时会提供可复现的元数据和SHA-256摘要。

## 同期処理の上限

- Import本文: 5 MiB以下
- Import行数: 1,000行以下
- Export件数: 1,000 Record以下
- 文字コード: UTF-8

同期上限を超える処理には非同期APIを使用する。非同期Importは既定で100 MiB・100,000行、非同期Exportは100,000 Recordまでとする。

## Import

```http
POST /api/v1/imports
Authorization: Bearer <JWT or API key>
Content-Type: application/json
```

```json
{
  "format": "jsonl",
  "content": "{\"instruction\":\"Q\",\"output\":\"A\"}",
  "idempotency_key": "client-run-20260831-001",
  "file_name": "training.jsonl",
  "defaults": {
    "language_code": "ja",
    "status": "draft"
  }
}
```

同じ利用者と冪等キーで同じcontentを再送した場合は既存Jobを200で返す。contentのSHA-256が異なる場合は`IDEMPOTENCY_CONFLICT`で409を返す。

Importごとに`source_type=imported`のSourceを作成し、作成した全Recordへ関連付ける。原文は`import_jobs.raw_content`へ保存するが、APIレスポンスには返さない。本文のSHA-256、byte数、ファイル名も保持する。

行ごとに短いトランザクションを使用する。不正行だけを`import_items.status=failed`として記録し、正常行は保存する。

```text
completed             全行成功
completed_with_errors 成功行と失敗行が混在
failed                parse失敗または全行失敗
```

JSONは配列、`{"records": [...]}`、単一objectを受け付ける。JSONLは空行を無視する。CSVは先頭行をheaderとして、quoted fieldとescaped quoteを処理する。

## Export

```http
POST /api/v1/exports
Content-Type: application/json
```

```json
{
  "format": "jsonl",
  "status": "approved",
  "record_type": "instruction",
  "language_code": "ja"
}
```

レスポンス本文がファイル内容になる。以下のheaderを返す。

```text
Content-Disposition
X-Export-ID
X-Content-SHA256
```

Exportは論理削除されていないRecordの現在Versionだけを含む。CSVでは`content`と`metadata`をJSON文字列として格納する。

## 非同期処理

```text
POST /api/v1/imports/async
POST /api/v1/exports/async
```

APIはImport原本をMinIOへ保存し、PostgreSQLへqueued Jobを作成してRedisへ通知する。Redisは通知経路であり、Job状態の正本はPostgreSQLとする。通知が失われてもWorkerはqueued Jobをpollして取得できる。

Workerは`FOR UPDATE SKIP LOCKED`でJobをclaimする。Importは既定50行ごとに進捗を更新し、各Record保存は短いトランザクションで行う。取消要求はchunk境界で確認する。

```text
queued → processing ─┬→ completed
                    ├→ completed_with_errors
                    ├→ failed
                    └→ cancelled
```

Worker停止で5分以上processingのままになったJobは、Worker起動時にqueuedへ戻す。Import再開時は`import_items`の最大row番号と成功・失敗件数を再計算し、次の行から続行する。

完了した非同期Exportは`GET /api/v1/exports/:id/download`から取得する。成果物本体はMinIO、checksum・件数・状態はPostgreSQLを正本とする。

## APIと権限

```text
GET/POST /api/v1/imports       imports:create、admin／editor
GET      /api/v1/imports/:id   imports:create、admin／editor
POST     /api/v1/exports       exports:create、admin／editor／reviewer
GET      /api/v1/exports/:id   exports:create、admin／editor／reviewer
```

Job一覧・詳細は認証主体の所有Jobだけを返す。Importで生成したSourceとRecordの作成は既存監査ログへ記録する。Job自体の専用監査actionは未実装。

## 次工程

- [Done] 同期JSON／JSONL／CSV Import・Export
- [Done] 原文、checksum、冪等性、部分成功、行別エラー
- [Done] MinIO原本AssetとRedis Queue
- [Done] Workerによるchunk処理、再開、取消、進捗
- [Next] Dataset Definition・Snapshot・manifest生成
- [Later] Parquet／Apache Arrow
