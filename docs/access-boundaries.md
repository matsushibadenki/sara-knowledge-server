# Access boundaries

更新: 2026-09-08。現在のAPIが提供する単一組織向けworkspace境界を定義する。複数組織SaaSの隔離保証ではない。

## 現在の契約

| Resource | 読み取り・参照範囲 | 書き込み条件 |
| --- | --- | --- |
| Source／Record | active workspace member | scopeとworkspace roleに従う |
| Event／Experience／Entity／Concept／Relation | active workspace member | scopeとworkspace roleに従う |
| Dataset Definition／Snapshot、Model／Training Run | active workspace member | scopeとworkspace roleに従う |
| Import／Export／Event ingestion Job、Asset | active workspace member | scopeとworkspace roleに従う |

認証middlewareはactive userに加えてactive workspace membershipを必須とし、membershipがなければ`WORKSPACE_ACCESS_REQUIRED`で拒否する。`created_by`と`owner_id`は作者・操作主体の由来であり、アクセス判定には使わない。論理削除された対象は新規参照できず、完成が必要なDataset Snapshotは`completed`だけを参照できる。

polymorphic referenceの状態判定は`apps/api/src/services/resource-access.js`へ集約する。resource type、論理削除条件、必要な状態、単体・複数ユーザー統合テストを同時に追加する。不明なresource typeは許可せずエラーにする。

API keyも発行者のactive membershipとworkspace roleを検査する。API key scopeはroleを補う操作権限であり、role検査を迂回しない。

## 進捗と制限

- [Done] singleton workspace、membership status、workspace roleを追加
- [Done] 既存userを初期workspaceへmigrationし、作者とアクセス境界を分離
- [Done] 全resource、Job、Export、Snapshot、Assetをmembership境界で共有
- [Done] RecordをRelation端点／Evidenceに使用したときの不正SQLを修正
- [Done] 別editorによる共有Memory参照と、membershipを持たないuserの拒否を統合テスト
- [Next] G0.2として承認状態と内容revisionの整合性を修復
- [Later] 境界テストと運用監査の完了後、必要であれば複数組織SaaSとして提供

現schemaは`scope_key = 'server'`のunique制約でworkspaceを1件に限定する。この制約があるためresource tableへ`workspace_id`を重複保持しない。複数workspace対応時は、全resourceとJobへ`workspace_id`を追加して複合unique／index／境界テストを実装してからsingleton制約を外す。

## English

The product now enforces an explicit singleton workspace. Every protected resource requires an active membership; membership roles and API-key scopes jointly authorize operations. `created_by` remains attribution, not an access boundary. The database constraint permits only one server workspace, so this is not a multi-tenant SaaS isolation claim.

## 简体中文

当前产品已实施明确的单一工作空间边界。所有受保护资源都要求有效成员资格，并由成员角色与API密钥权限共同授权。`created_by`只表示作者，不再作为访问边界。数据库约束只允许一个服务器工作空间，因此这不代表多租户SaaS隔离。
