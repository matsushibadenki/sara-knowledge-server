# Memory Core実装記録 — 2026-08-31

## 到達した節目

- [Done] `memory` PostgreSQL schema
- [Done] Experience、Event、Entity、Concept、Relation
- [Done] Source provenanceとExperience–Event関連
- [Done] proposal source、verification state、confidence
- [Done] reward、prediction error、quality、novelty
- [Done] Relationの時間差、validity、context
- [Done] 多型node typeのDB CHECKとサービス層存在検証
- [Done] 所有者境界、role、`memory:read`／`memory:write`
- [Done] CRUDと論理削除
- [Done] incoming／outgoing neighbor検索
- [Done] 外部キー索引、複合索引、active行部分索引

## 実装中に検出・修正した問題

部分更新時に、未指定のnullable fieldを`null`へ上書きする問題を統合テストが検出した。現在値とPATCH入力をマージしてからDB列へ変換する方式へ変更し、未指定の`event_pattern`やprovenanceを保持するよう修正した。

## 統合検証

- Source付きExperience／Event／Entity／Conceptの作成
- LLM生成Eventを`candidate`として保存
- UID重複拒否
- 存在しないSource参照拒否
- 存在しないRelation target拒否
- Entity–Concept Relationとneighbor取得
- Concept検証状態の部分更新と未指定event pattern保持
- 別所有者からの取得拒否
- Event論理削除後の通常取得拒否
- 有効Relationから参照中のConcept削除拒否
- 基本テスト: 9 pass、1 integration skip、19 assertions
- Docker統合テスト: 10 pass、261 assertions、0 failures
- migration `0016_powerful_leopardon.sql`を適用
- `auth`／`dataset`／`training`／`memory`／`system` schemaの外部キー索引漏れ: 0件
- API readiness: HTTP 200
- Worker／API log: 起動後エラーなし
- `git diff --check`: 問題なし

## 次の節目

- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Next] Bulk Event ingestion・bounded graph traversal
- [Later] bulk Event、graph traverse、Embedding、Activation、Replay
