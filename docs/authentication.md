# Authentication

## 現在の実装

初期認証は、`auth.users`を利用したメールアドレス・パスワードログインとJWTアクセストークンで構成する。

- パスワードハッシュ: Bun `argon2id`
- JWT署名: HS256
- JWT issuer: `sara-knowledge-server`
- JWT audience: `sara-knowledge-api`
- デフォルトのアクセストークン有効期間: `15m`
- Refresh TokenはDBにハッシュのみ保存し、使用時にローテーションする
- Refresh Token更新時は対象行をロックし、同じTokenの同時再利用を拒否する
- APIキー本体は作成時に一度だけ返し、DBにはSHA-256ハッシュのみ保存する
- Bearer認証時は署名だけでなく、ユーザーが現在も有効かDBで確認する
- APIキー認証時は失効日時、有効期限、所有ユーザーの状態を確認し、利用成功時に`last_used_at`を更新する

## API

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
GET  /auth/api-keys
POST /auth/api-keys
DELETE /auth/api-keys/:id
```

API v1の入口にも同じ認証エンドポイントを公開する。

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
GET  /api/v1/auth/api-keys
POST /api/v1/auth/api-keys
DELETE /api/v1/auth/api-keys/:id
```

ログイン例:

```json
{
  "email": "admin@example.com",
  "password": "your-password"
}
```

認証後は以下の形式で送信する。

```text
Authorization: Bearer <access_token>
```

Refresh Tokenはログインまたは更新レスポンスの`refresh_token`として返される。更新時は古いTokenを失効させ、新しいRefresh Tokenを発行する。

## APIキー認証

設計書に従い、APIキーもBearer形式で送信する。

```text
Authorization: Bearer sara_<API_KEY>
```

JWTとAPIキーは`sara_`プレフィックスで区別する。APIキーはRecordなどの機械アクセスに利用できるが、`/auth/me`とAPIキー管理APIはJWTアクセストークン専用とする。

Record APIで現在利用するscope:

```text
records:read   GETによる一覧・詳細・Version参照
records:write  POST・PATCH・DELETE・復元
```

scopeが不足する場合は`403 INSUFFICIENT_SCOPE`、無効・期限切れ・失効済みの場合は`401 INVALID_TOKEN`を返す。scopeを持たないAPIキーは、scope保護されたAPIへアクセスできない。

APIキー作成例:

```json
{
  "name": "Read-only integration",
  "scopes": ["records:read"],
  "expires_at": "2027-01-01T00:00:00.000Z"
}
```

作成時に指定できるscopeはサーバー側の許可リストで検証し、重複scopeは除去する。

## ユーザーロール認可

JWT利用者はDB上の最新roleで認可する。Token内の古いroleだけでは判定しない。

```text
admin      すべての現在実装済み操作
editor     Recordの閲覧・作成・更新・論理削除・復元
reviewer   Recordの閲覧
viewer     Recordの閲覧
service    JWTによるRecord操作は不可。APIキーscopeを利用
```

APIキーの発行・一覧・失効は現在`admin`専用とする。role不足は`403 INSUFFICIENT_ROLE`を返す。DBにも`admin / editor / reviewer / viewer / service`のCHECK制約を設定する。

## ログイン試行回数制限

ログイン試行は、正規化したメールアドレスを秘密値でpepperしてSHA-256化し、Redisで固定窓カウンターとして管理する。メールアドレスそのものはRedisキーへ保存しない。

既定値:

```dotenv
LOGIN_MAX_ATTEMPTS=5
LOGIN_ATTEMPT_WINDOW_SECONDS=900
```

既定では15分内の5回目まで認証を試行でき、6回目から`429 RATE_LIMITED`と`Retry-After`を返す。成功ログイン時はカウンターを解除する。Redis障害時は保護を迂回せず`503 DEPENDENCY_UNAVAILABLE`を返す。

## 開発用管理者seed

```bash
docker compose exec api bun run db:seed
```

環境変数:

```dotenv
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_admin_password
ADMIN_DISPLAY_NAME=SARA Administrator
ADMIN_LOCALE=ja
```

`ADMIN_PASSWORD`は12文字以上を要求する。seedはメールアドレスを一意キーとして冪等に実行できる。

開発用のデフォルトパスワードを本番で使用してはならない。

## セキュリティ上の注意

- JWT secretを本番用の強い秘密値へ変更する
- パスワードやJWT本体をログへ出力しない
- エラー応答でユーザー存在の有無を区別しない
- アクセストークンを短寿命にする
- Refresh Tokenはローテーション後の再利用を拒否する
- APIキー本体をログやDBへ保存しない

## 次の認証実装

- APIキーのローテーション支援
- ユーザー管理APIとrole変更監査
- API全体の用途別レート制限
