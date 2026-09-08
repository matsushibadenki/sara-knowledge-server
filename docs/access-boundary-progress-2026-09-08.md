# Access boundary progress — 2026-09-08

## 実装

- [Done] polymorphic参照判定を共通化し、workspace移行後は全対象を同じmembership境界へ統一
- [Done] `dataset.records`に存在しない`created_by`を参照して不正SQLを生成していたMemoryのRecord参照を修正
- [Done] 単件EventとBulk EventのSource参照条件を共有コーパス契約へ統一
- [Done] Asset binding、Relation endpoint、Relation Evidenceが同じ参照判定を利用
- [Done] 不明なpolymorphic typeをfail closedにする単体テスト
- [Done] `auth.workspaces`と`auth.workspace_memberships`を追加し、migrationで既存userを初期workspaceへ移行
- [Done] `scope_key = 'server'`のunique／check制約で、resourceにworkspace IDがない段階で複数workspaceが作られることを防止
- [Done] user tokenとAPI keyの両方でactive membershipを必須化し、membership roleを認可に使用
- [Done] `created_by`／`owner_id`を作者情報として維持し、Memory、Dataset、Training、Job、Export、Snapshot、Assetのアクセス条件から分離
- [Done] 別editorによる共有Source／Record／Memory参照と、membershipを持たないuserの拒否を実DBで確認

## 検証

- migration前に`pg_dump -Fc`を取得し、一時DBへの`pg_restore`、workspace migration、workspace／membership件数照合に成功
- `bun test`: 13 pass、1 integration skip、0 fail、28 assertions
- `docker compose exec -T -e RUN_INTEGRATION=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test`: 14 pass、0 fail、379 assertions
- `MINIO_PUBLIC_ENDPOINT`を指定しない最初のDocker統合試験は、コンテナ内から公開用`localhost:9000`へ接続できず失敗した。テストprocessだけCompose内部のMinIOへ向けて再実行した。通常APIの公開署名URL設定は変更していない。

## 残る制限

- [Next] 承認状態と内容revisionの整合性はG0.2で修復する。
- [Later] 複数workspaceを提供する場合は、全resource／Jobへ`workspace_id`を追加して複合uniqueと境界テストを通してからsingleton制約を外す。
- [Later] RLSやDB role分離は、API境界とmigrationの完成後に必要性を評価する。

## English

Added and backfilled a singleton workspace membership boundary, separated creator attribution from authorization, and applied membership roles to user tokens and API keys. Backup restore, unit tests, and the full Docker integration suite pass. Multi-workspace isolation remains a later, explicit schema migration.

## 简体中文

已添加并回填单一工作空间成员边界，将作者信息与授权分离，并让用户令牌及API密钥统一使用成员角色。备份恢复、单元测试和完整Docker集成测试均已通过。多工作空间隔离仍需后续明确的数据库迁移。
