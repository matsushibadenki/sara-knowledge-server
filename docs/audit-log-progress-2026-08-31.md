# Source・Record監査ログ 実装記録 2026-08-31

## 実装結果

- [Done] `system.audit_logs`テーブル
- [Done] actor、action、resource typeのDB CHECK制約
- [Done] リソース、actor、request ID、時系列の検索索引
- [Done] cursor paginationと検索条件に対応した複合索引
- [Done] Source／Record変更と同一トランザクションで監査INSERT
- [Done] create・update・delete・restoreのbefore／after snapshot
- [Done] Record本文、Source license全文、metadata値を複製しないデータ最小化
- [Done] server-generated `X-Request-ID`との相関
- [Done] JWT admin専用の監査一覧・詳細API
- [Done] APIキー操作時のAPIキーIDと所有ユーザーID記録
- [Done] OpenAPI、README、DB・認証ドキュメント更新

## 検証結果

- [Done] migration `0006_sharp_reptil.sql`をDocker上のPostgreSQLへ適用
- [Done] 基本テスト9件成功、失敗0件
- [Done] Source／Record監査とカーソルページングを含む全10テスト・112 assertions成功、失敗0件
- [Done] viewerは403、APIキーは401、adminは一覧・詳細取得可能
- [Done] Version競合で失敗した更新が追加監査を残さないことを件数で確認
- [Done] Record本文が監査JSONへ含まれないことを確認

## 設計判断

監査ログへ本文を複製せず、不変Record Versionを参照できる識別情報だけを保存する。監査ログの検索性と、個人情報・学習データの不要な複製防止を両立する。

IPアドレスは、接続元と信頼proxyの境界を定義する前に`X-Forwarded-For`を信用しない。列だけを確保し、現在はnullとする。

現在はアプリケーション上の追記専用であり、DB管理者や同一DB roleからの改変まで防ぐものではない。権限分離とtamper evidenceは本番化前の別工程とする。
