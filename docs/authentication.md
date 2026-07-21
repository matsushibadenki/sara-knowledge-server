# Authentication

## 現在の実装

初期認証は、`auth.users`を利用したメールアドレス・パスワードログインとJWTアクセストークンで構成する。

- パスワードハッシュ: Bun `argon2id`
- JWT署名: HS256
- JWT issuer: `sara-knowledge-server`
- JWT audience: `sara-knowledge-api`
- デフォルトのアクセストークン有効期間: `15m`
- Refresh TokenはDBにハッシュのみ保存し、使用時にローテーションする
- APIキー本体は作成時に一度だけ返し、DBにはSHA-256ハッシュのみ保存する

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

- APIキーによるリクエスト認証
- scope認可middleware
- ログイン試行回数制限
- ロール・scope認可middleware
