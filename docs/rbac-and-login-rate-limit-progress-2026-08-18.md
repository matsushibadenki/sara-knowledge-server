# ロール認可・ログイン制限 実装記録 2026-08-18

## 実装結果

- [Done] `admin / editor / reviewer / viewer / service`のrole定義
- [Done] user statusとroleのPostgreSQL CHECK制約
- [Done] Record閲覧を`admin / editor / reviewer / viewer`へ許可
- [Done] Record変更を`admin / editor`へ限定
- [Done] APIキー管理を`admin`へ限定
- [Done] APIキーはroleではなくscopeで認可する分離設計
- [Done] Redisによるメール単位のログイン試行回数制限
- [Done] メールアドレスを秘密値でpepperしたハッシュキーとして保存
- [Done] 429応答と`Retry-After`ヘッダー
- [Done] 成功ログイン時のカウンター解除
- [Done] Redis障害時の503応答

## 検証結果

- [Done] migration 5件目としてrole・status制約を適用
- [Done] viewerによるRecord閲覧は200
- [Done] viewerによるRecord作成は`403 INSUFFICIENT_ROLE`
- [Done] viewerによるAPIキー管理は403
- [Done] 既定5回の失敗は401、6回目は`429 RATE_LIMITED`
- [Done] `Retry-After`が正の秒数で返る
- [Done] 成功ログイン後に試行カウンターが解除される
- [Done] Docker実DB・Redis統合テスト10件成功、失敗0件

## 次の優先事項

- [Done] Source APIとRecordの出典登録フロー（2026-08-21完了）
- [Next] Source・Record変更の監査ログ
- [Next] ユーザー管理APIとrole変更監査
- [Later] API全体の用途別レート制限
- [Later] APIキーローテーション支援
