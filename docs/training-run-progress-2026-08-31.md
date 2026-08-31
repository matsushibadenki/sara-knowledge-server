# Training Run実装記録 — 2026-08-31

## 到達した節目

- [Done] `training` PostgreSQL schemaを追加
- [Done] `training.models` Model Registry
- [Done] `training.runs`と完成済みDataset Snapshotの関連付け
- [Done] Run作成時の`model_snapshot`固定
- [Done] transformer、code revision、seed、parameters、environmentの保存
- [Done] guarded lifecycle transitionと同時更新検出
- [Done] `training.metrics`の追記型評価履歴
- [Done] MetricのRun・name・split・step重複防止
- [Done] 外部キー、複合索引、active run部分索引
- [Done] `training:read`／`training:write` scopeとowner境界

## 設計判断

Model Registryは管理上変更可能だが、Runの再現性を可変行へ依存させない。Run作成時にModelの名前、provider、family、version、base model、configuration、revisionをJSONBへ固定する。学習データはDataset Snapshotが正確なRecord Versionを固定しているため、RunはそのSnapshot IDを参照する。

評価値を一つの最終scoreへ上書きせず、step、epoch、split、metadata付きMetricとして追記する。completed後にも評価Metricを追加可能とし、学習完了後のvalidation／test評価を同じRunへ関連付ける。

## 検証項目

- scope不足APIキーの拒否
- Model名とRun UIDの重複拒否
- 未完成・不存在Snapshotを使うRunの拒否
- queued中のMetric追加拒否
- 許可された状態遷移と終端状態からの再遷移拒否
- Metric重複拒否
- Model更新後もRun内Model Snapshotが旧Versionを維持
- Runが正確なDataset Snapshot、変換器Version、2件のMetricを維持

## 最終検証

- 基本テスト: 9 pass、1 integration skip、19 assertions
- Docker統合テスト: 10 pass、235 assertions、0 failures
- migrations `0014_talented_doorman.sql`、`0015_smiling_nicolaos.sql`を適用
- `auth`／`dataset`／`training`／`system` schemaの外部キー索引漏れ: 0件
- API readiness: HTTP 200
- Worker／API log: 起動後エラーなし
- `git diff --check`: 問題なし

## 次の節目

- [Done] Event・Experience・Entity・Concept・Relationの最小Memory Schema
- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Next] Bulk Event ingestion・bounded graph traversal
- [Later] checkpoint／artifact詳細、Run比較、trainer callback認証
