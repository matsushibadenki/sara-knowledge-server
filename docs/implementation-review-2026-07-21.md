# 実装レビュー 2026-07-21

## 結果

ここまでのAPI、認証、Record履歴、DB migration、Docker構成、管理画面を横断確認した。

重大または高優先度の既知不具合は修正済み。Docker上の実DBを使った統合テストまで成功している。

## 修正した問題

- [Done] Record同時更新で同じ版番号を作成できる競合を、親Recordの行ロックで防止
- [Done] `(record_id, version_number)`と現在版1件の一意制約を追加
- [Done] `records.current_version_id`の外部キーと主要検索インデックスを追加
- [Done] Refresh Tokenの同時ローテーションを行ロックし、同じTokenの再利用を拒否
- [Done] Bearer Token検証時に、有効なユーザーがDB上に存在することを確認
- [Done] 不正なUUID、ページ、limit、filterを500ではなく400で拒否
- [Done] 空のRecord更新を拒否し、Content必須条件を明示
- [Done] APIの404、予期しない500を共通JSON形式に統一
- [Done] 許可Origin方式のCORSを追加
- [Done] Redis readinessをTCP接続だけでなく`PING` / `PONG`で確認
- [Done] ComposeからJWT、Token期限、管理者seed設定をAPIへ渡すよう修正
- [Done] 本番で弱いJWT secretを使用した起動を拒否
- [Done] Docker buildをroot lockfile固定に変更し、`.dockerignore`を追加
- [Done] 既存volumeにもPostgreSQL拡張を適用する冪等migrationを追加
- [Done] 管理画面skeletonを日本語、英語、简体中文に対応

## 検証結果

- [Done] Drizzle migration 4件を既存PostgreSQL volumeへ適用
- [Done] `pgcrypto`、`vector`、`pg_trgm`、`unaccent`、`citext`を確認
- [Done] APIテストと実DB統合テスト: 8件成功、失敗0件
- [Done] Record同時更新: 1件成功、1件`409 VERSION_CONFLICT`
- [Done] Refresh Token同時更新: 1件成功、1件`401 INVALID_REFRESH_TOKEN`
- [Done] Record Versionは2件、現在版は1件だけであることを確認
- [Done] Next.js production build成功
- [Done] API readinessでPostgreSQL、Redis、MinIOがすべて`ok`
- [Done] 管理画面のホスト公開ポートでHTTP 200を確認

## 次の優先事項

- [Next] APIキーによるリクエスト認証とscope認可
- [Next] ロール認可、ログイン試行制限、監査ログ
- [Done] Source APIとRecordの出典登録フロー（2026-08-21完了）
- [Next] Source・Record変更の監査ログ
- [Later] インポート、エクスポート、解析Worker、Knowledge構造化
