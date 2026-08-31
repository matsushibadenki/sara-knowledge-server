# 非同期Worker実装記録（2026-08-31）

- [Done] Import原本とExport成果物のMinIO保管
- [Done] Redis ListによるJob通知
- [Done] PostgreSQL Jobを唯一の状態正本として維持
- [Done] `FOR UPDATE SKIP LOCKED`による複数Worker対応claim
- [Done] 既定50行chunkの進捗・取消確認
- [Done] system主体のImport Record監査
- [Done] 5分以上古いprocessing Jobの自動再queue
- [Done] Import Item集計による中断位置からの再開
- [Done] 同期APIとの形式・品質score・confidence検証互換
- [Done] 非同期Import→Worker→非同期Export→MinIO download統合試験
- [Done] Docker上の全10テスト・192 assertions成功、失敗0件
- [Done] auth／datasetスキーマの外部キー索引漏れ0件
- [Done] PostgreSQL、Redis、MinIO readiness正常、Worker error logなし
- [Next] Dataset Definition・Snapshot・学習用manifest生成

> **English:** Redis is a notification channel; PostgreSQL remains the authoritative job state. MinIO stores source and result objects.
>
> **简体中文：** Redis仅作为通知通道；PostgreSQL仍是任务状态的权威来源，MinIO保存导入原文件和导出结果。
