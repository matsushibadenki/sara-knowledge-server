# Sources API

## 目的

Sourceは、Recordの内容がどこから来たか、どのライセンス条件で取得したかを追跡するための出典レコードである。PostgreSQLの`dataset.sources`を正本とし、Recordは`source_id`で参照する。

> **English:** Sources preserve provenance, retrieval details, licensing, and copyright metadata independently from records.
>
> **简体中文：** Source 独立保存数据来源、获取信息、许可和版权元数据，并由 Record 通过 `source_id` 引用。

## API

基本URL:

```text
/api/v1/sources
```

互換のため、ルートの`/sources`も提供する。

```text
GET    /sources
POST   /sources
GET    /sources/:id
PATCH  /sources/:id
DELETE /sources/:id
POST   /sources/:id/restore
```

一覧は`page`、`limit`、`source_type`、`q`を受け付ける。`q`はtitle、URL、author、publisherを部分一致で検索する。

すべてBearer認証を必要とする。

```text
GET                         sources:read
POST / PATCH / DELETE      sources:write
restore                    sources:write
```

JWTユーザーでは閲覧を`admin / editor / reviewer / viewer`、変更を`admin / editor`に限定する。APIキーではroleではなくscopeで認可する。

## 対応するsource_type

```text
manual
website
document
book
dataset
conversation
sensor
generated
imported
wordpress
```

APIのZod SchemaとPostgreSQLのCHECK制約の両方で検証する。

## 作成例

```json
{
  "source_type": "website",
  "title": "出典ページ",
  "url": "https://example.com/source",
  "author": "Example Author",
  "publisher": "Example Publisher",
  "published_at": "2026-08-01T00:00:00.000Z",
  "retrieved_at": "2026-08-21T00:00:00.000Z",
  "license_type": "CC BY 4.0",
  "copyright_status": "licensed",
  "content_hash": "sha256:...",
  "metadata": {}
}
```

`license_type`と`copyright_status`は、外部データの多様な状態を失わず取り込めるよう現段階では自由文字列とする。運用語彙が安定した後に列挙型候補を評価する。

## Recordとの関連付け

Sourceを先に作成し、返されたUUIDをRecordの`source_id`へ指定する。

```json
{
  "record_type": "plain_text",
  "source_id": "00000000-0000-0000-0000-000000000000",
  "content": {
    "text": "原文"
  }
}
```

Recordの作成または更新時には、Sourceが存在し、論理削除されていないことを同じDBトランザクション内で確認する。利用できないSourceの場合は`404 SOURCE_NOT_FOUND`を返し、Recordや新しいVersionを作成しない。

Record詳細レスポンスには`source_id`に加えて`source`を含める。これにより、出典が後から論理削除されても既存Recordから出典情報と`deleted_at`を追跡できる。

## 削除方針

`DELETE`は論理削除であり、SourceやRecordの参照を物理削除しない。論理削除後は新しいRecordへ関連付けられないが、既存Recordのprovenanceは保持する。`POST /sources/:id/restore`で復元できる。

Source詳細の`meta.active_record_count`は、そのSourceを参照する論理削除されていないRecord数を返す。

## 索引

初期実装では次の検索用索引を持つ。

- 有効Sourceの`updated_at`
- `source_type`
- `url`
- `content_hash`

URLやhashは重複候補の検索に使うが、同じ出典から複数の取得・版を保持できるよう一意制約にはしない。
