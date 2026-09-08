# Asset API

## 日本語

画像、音声、動画、PDF、元文書などのbinary本体はPostgreSQLへ保存しない。PostgreSQLをmetadata・状態・provenance bindingの正本とし、開発環境ではMinIOをbinary objectの正本とする。

## Upload lifecycle

```text
POST /api/v1/assets/upload-url
  ↓ metadata予約＋binding検証
pending Asset
  ↓ 5分間のpresigned PUT
object storage
  ↓
POST /api/v1/assets/:id/complete
  ↓ size＋SHA-256検証
ready Asset
```

- [Done] 1 byte〜`MAX_UPLOAD_SIZE_MB`の範囲で予約する。
- [Done] object keyはserverが生成し、元filenameをpathへ使わない。
- [Done] presigned URLは5分で失効する。
- [Done] 完了時にobjectの存在、size、SHA-256を検証する。
- [Done] 完了処理は冪等で、ready Assetの再完了は既存結果を返す。
- [Done] hash不一致ではreadyにせず、pendingのまま再uploadできる。
- [Done] download URLも5分で失効し、ready Assetだけに発行する。
- [Done] 削除はmetadataを論理削除してからobject cleanupを試行する。

## Provenance binding

Assetは少なくとも1つの所有対象にbindingする。

```text
Asset
├─ source: origin／scan／download
├─ record: attachment／primary／thumbnail
└─ event: observation／frame／audio-window
```

binding対象は呼出者が所有するactive Source／Record／Eventに限定する。polymorphic targetへDB foreign keyは設定できないため、APIで所有者と存在を検証し、`target_type + target_id` indexで逆引き可能にする。

同一所有者に同じSHA-256のready Assetがある場合、uploadを禁止せず`duplicate_asset_ids`として返す。異なるprovenanceやlicenseを保持する必要があるため、binary同一性と知識上の同一性を混同しない。

## Security and operations

- MIME typeとfilenameはmetadataであり、contentの安全性を保証しない。
- downloadはattachment用途を基本とし、将来inline表示する場合はContent Security Policy、safe MIME allowlist、malware scanを追加する。
- 現在の完了検証は100 MiB以下をmemoryへ読みSHA-256を計算する。上限を増やす前にstreaming hashまたはWorker検証へ移す。
- `MINIO_PUBLIC_ENDPOINT`は利用者から到達できるHTTPS endpointへ設定する。本番でNFSを使う場合、NFS pathをclientへ公開せずApp VPSのupload／download gatewayまたはS3-compatible gatewayを通す。
- 通常VPS WorkerはAsset metadataをHTTPS APIで登録し、Managed PostgreSQLへ直接接続しない。

## API

```text
POST   /assets/upload-url
POST   /assets/:id/complete
GET    /assets
GET    /assets/:id
GET    /assets/:id/download-url
DELETE /assets/:id
```

Scopes：

```text
assets:read
assets:write
```

## English

Binary content lives in object storage; PostgreSQL is authoritative for metadata, lifecycle state, and provenance. Upload reservations produce workspace-scoped object keys and five-minute presigned PUT URLs. Completion verifies existence, byte size, and SHA-256 before marking an Asset ready. Bindings are restricted to active Sources, Records, and Events in the authenticated singleton workspace.

Duplicate hashes are reported rather than rejected because identical bytes can have different provenance or licensing. Production NFS paths must remain private behind an App VPS upload／download gateway or an S3-compatible gateway.

## 简体中文

二进制内容保存在对象存储中；PostgreSQL是元数据、生命周期状态和来源绑定的权威数据源。上传预约生成服务器控制的object key和五分钟有效的presigned PUT URL。完成操作验证对象存在性、字节大小与SHA-256后，才把Asset标记为ready。绑定目标仅限调用者拥有的active Source、Record和Event。

相同哈希只作为重复候选返回，不直接拒绝，因为相同字节可能具有不同来源或许可证。生产环境中的NFS路径不得直接暴露给客户端，应通过App VPS上传／下载gateway或S3-compatible gateway访问。

## Roadmap

- [Done] Presigned upload／download, completion verification, workspace membership, provenance binding
- [Done] Duplicate detection without forced deduplication
- [Next] Asset processing jobs, media metadata extraction, and derived-Asset provenance
- [Later] Malware scanning, streaming hash, multipart upload, retention cleanup
