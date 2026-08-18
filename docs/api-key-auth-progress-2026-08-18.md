# APIキー認証 実装記録 2026-08-18

## 実装結果

- [Done] `Authorization: Bearer sara_<API_KEY>`による機械認証
- [Done] JWTとAPIキーの認証経路を分離
- [Done] APIキーのハッシュ照合、失効、有効期限、所有ユーザー状態の検査
- [Done] 認証成功時の`last_used_at`更新
- [Done] `records:read`と`records:write`によるRecord API認可
- [Done] scope不足時の`403 INSUFFICIENT_SCOPE`
- [Done] APIキー管理APIをJWT専用として維持
- [Done] APIキー作成scopeの許可リスト検証と重複除去
- [Done] OpenAPI skeletonへBearer認証と必要scopeを追記

## 検証結果

Docker上のPostgreSQLを使用した統合テストで以下を確認した。

- [Done] `records:read`キーによるRecord一覧取得は200
- [Done] 同じキーによるRecord作成は403
- [Done] APIキーによるAPIキー管理要求は401
- [Done] APIキー利用後に`last_used_at`が記録される
- [Done] 有効期限切れのAPIキー利用は401
- [Done] 失効後のAPIキー再利用は401
- [Done] 未知のscopeを指定したAPIキー作成は400
- [Done] APIテスト9件成功、失敗0件

## 次の優先事項

- [Done] ユーザーロールに基づく操作認可
- [Done] ログイン試行回数制限
- [Next] Source APIと出典登録フロー
- [Later] APIキーのローテーション支援と監査ログ
