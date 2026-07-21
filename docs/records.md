# Records API

## 現在の実装

認証済みユーザー向けに、学習データの親レコードと不変のバージョン履歴を管理する。

基本URL:

```text
/api/v1/records
```

互換のため、ルートの`/records`も提供する。

## API

```text
GET    /records
POST   /records
GET    /records/:id
PATCH  /records/:id
DELETE /records/:id
POST   /records/:id/restore
GET    /records/:id/versions
```

すべてBearer access tokenを必要とする。

## 作成

作成時に、親レコードとVersion 1を同一トランザクションで作成する。

```json
{
  "record_type": "instruction",
  "title": "サンプル",
  "language_code": "ja",
  "content": {
    "instruction": "質問",
    "output": "回答"
  },
  "plain_text": "質問 回答",
  "metadata": {}
}
```

## 更新

更新時は、必ず`expected_version`を送信する。

```json
{
  "expected_version": 1,
  "content": {
    "instruction": "質問",
    "output": "改善された回答"
  },
  "change_summary": "回答を改善"
}
```

最新Versionと一致しない場合は`409 VERSION_CONFLICT`を返す。既存Versionは上書きせず、新しいVersionを追加する。

## 削除と復元

`DELETE`は論理削除であり、履歴と本文を物理削除しない。`POST /records/:id/restore`で復元できる。

## 一覧の方針

一覧APIでは巨大な本文を返さず、レコードのsummaryを返す。本文と現在Versionは詳細APIで取得する。

## 対応する初期record_type

```text
plain_text
instruction
qa
chat
sharegpt
chatml
dpo
rlhf
classification
image_caption
multimodal
event_sequence
custom
```

各形式の詳細Schema検証は、データ形式ごとのvalidator追加時に実装する。

## 確認済みフロー

Docker上のPostgreSQLを使い、以下を確認済み。

```text
ログイン
→ 作成（Version 1）
→ 更新（Version 2）
→ Version一覧取得
→ 論理削除
→ 復元
```

