# Audit Logs

## 目的

SourceとRecordの重要な変更を、変更対象と同じDBトランザクションで`system.audit_logs`へ記録する。変更だけ成功して監査が欠落する状態や、監査だけ残って変更が失敗する状態を防ぐ。

> **English:** Source and Record mutations write an audit entry in the same database transaction, with data-minimized before/after snapshots.
>
> **简体中文：** Source 和 Record 的变更会在同一数据库事务中写入审计记录，并使用最小化的变更前后快照。

## 現在の対象

```text
resource_type: source | record
action: create | update | delete | restore
actor_type: user | api_key | system
```

Source／Recordの作成、更新、論理削除、復元を記録する。Version競合、入力検証失敗、存在しないリソースなど、変更が成立しなかった要求は監査ログを作らない。

## 保存内容

```text
actor type / actor id
action
resource type / resource id
server-generated request id
user agent
before / after snapshot
changed fields
version fields changed
request method / path
created at
```

APIキー操作では`actor_id`にAPIキーID、`metadata.actor_user_id`に所有ユーザーIDを記録する。

すべてのHTTP応答へサーバー生成の`X-Request-ID`を付与し、監査ログの`request_id`と対応させる。クライアント指定値を監査IDとして採用しない。

## データ最小化

Recordの`content`と`plain_text`、Sourceの`license_text`、metadataの値は監査ログへ複製しない。

- Recordは親属性、現在Version ID／番号、Schema Versionを記録する
- 本文変更の有無は`metadata.version_fields_changed`へ記録する
- metadataはキー名だけを記録する
- Version本文とchange summaryは既存の不変`record_versions`を参照する

監査ログは機密情報を含み得るため、閲覧APIはJWTで認証した`admin`だけに限定する。APIキー、editor、reviewer、viewerは閲覧できない。

## API

```text
GET /api/v1/audit-logs
GET /api/v1/audit-logs/:id
```

互換のため`/audit-logs`にも公開する。更新・削除APIは提供しない。

一覧query:

```text
limit
cursor
action
resource_type
resource_id
actor_id
request_id
since
until
```

`since`と`until`はtimezone付きISO 8601で指定する。

大量の監査ログで深い`OFFSET`走査を避けるため、一覧はcursor paginationを使用する。レスポンスの`meta.has_more`がtrueの場合、`meta.next_cursor`を次の要求の`cursor`へ渡す。`resource_id`を指定するときは、複合索引を利用できるよう`resource_type`も必須とする。

## 索引

現在の閲覧経路に合わせて次を設定する。

- `created_at`
- `(action, created_at)`
- `(resource_type, resource_id, created_at)`
- `(actor_id, created_at)`
- `request_id`

等価条件を先、時刻範囲を後に置く複合索引とし、対象リソースの時系列取得で個別索引のbitmap合成を避ける。

## 現在の制限

- `ip_address`列は用意しているが、信頼できるproxy境界が未設定のため現在は保存しない
- APIは追記・参照だけだが、DB roleによるUPDATE／DELETE禁止はまだ分離していない
- login、APIキー発行・失効、approve、reject、import、exportはまだ対象外
- hash chain、署名、WORM storageなどのtamper evidenceは未実装
- 長期保存期間、partition、archive方針は負荷試験後に決定する

DB role分離前の現段階では「改ざん不可能な証跡」と表現しない。アプリケーション上の追記専用監査である。

## 次の拡張候補

- [Done] Source／Recordのcreate・update・delete・restore監査
- [Done] admin専用一覧・詳細API
- [Done] request ID、APIキーactor、変更field、データ最小化
- [Done] レビュー申請・承認・拒否・修正要求の監査
- [Next] Import／Export操作の監査
- [Later] login、APIキー、承認、Import／Export監査
- [Later] DB監査専用roleと更新・削除権限の分離
- [Later] tamper-evident hash chainまたは外部WORM archiveの比較
- [Later] 保存期間、partition、archive、復元試験
