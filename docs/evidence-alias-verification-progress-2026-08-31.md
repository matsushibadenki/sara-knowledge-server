# Evidence・Alias・Verification実装記録 — 2026-08-31

## 到達した節目

- [Done] `memory.relation_evidence`
- [Done] `memory.entity_aliases`
- [Done] `memory.verification_decisions`
- [Done] Evidence参照先の存在・所有者検証
- [Done] Evidence UID冪等性とRelation count原子的更新
- [Done] NFKC Alias正規化と有効行部分一意索引
- [Done] reviewer/admin限定の検証状態遷移
- [Done] expected stateによる同時更新検出
- [Done] append-only Decision履歴
- [Done] `memory:verify` scope

## 実装中に検出・修正した問題

禁止した`verification_state`を含むPATCHをZodが未知fieldとして除去し、同時指定された別fieldだけ更新する問題を統合テストが検出した。Memory PATCH schemaをstrict化し、禁止・未知fieldを400で拒否するよう修正した。

## 検証

- 全角`Ｂｅｌｌ`と` bell `を同じAliasとして重複拒否
- support Evidence追加でevidence count更新
- external counterexample追加でcounterexample count更新
- Evidence UID重複時にcountが増えないことを確認
- verification stateの直接PATCH拒否
- candidateからverifiedへのDecision
- 古いexpected stateによる再判定拒否
- Decision履歴取得
- 基本テスト: 9 pass、1 integration skip、19 assertions
- Docker統合テスト: 10 pass、278 assertions、0 failures
- migration `0017_curvy_goliath.sql`を適用
- `auth`／`dataset`／`training`／`memory`／`system` schemaの外部キー索引漏れ: 0件
- API readiness: HTTP 200
- Worker／API log: 起動後エラーなし
- `git diff --check`: 問題なし

## 次の節目

- [Next] Bulk Event ingestion・bounded graph traversal
- [Later] confidence calibration、独立Source集計、合議レビュー
