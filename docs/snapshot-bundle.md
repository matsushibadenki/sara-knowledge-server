# Snapshot再現バンドル / Snapshot reproduction bundle / 快照复现包

🟢 [Done] `GET /api/v1/datasets/:id/snapshots/:snapshotId/bundle` はハッシュ検証済みmanifest、固定Record Versionの本文と文脈、固定Source revisionの内容、保持済みAsset原本を一つのJSONとして取得する。Dataset、Record、Source、Assetの読取権限が必要。

各ファイルはパス、Base64データ、復号後サイズ、SHA-256を持つ。サーバーは保存したmanifestのハッシュとメンバーの版を確認し、Assetのサイズとハッシュをmanifestに照合する。欠落・不一致があればダウンロードは失敗する。レスポンスヘッダー `X-Content-SHA256` はJSONファイル全体のハッシュ。

ダウンロード後は `bun scripts/verify-snapshot-bundle.js FILE [sha256:...]` で検証する。ヘッダーを別に保存して渡すとファイル全体のハッシュも比較できる。外部URL先の本文はSourceレコードに保存された範囲で再現できる。同期取得は復号後の合計32 MiBまで。固定情報が不明なRecordや、Asset保持参照を欠くSnapshotは409を返す。

隔離PostgreSQL、Redis、MinIOでDataset／Training統合試験が成功（85アサーション）。旧版の取得、manifest一致、原本の同サイズ改変と欠落を確認。また、オフライン検証コマンドの正常系とAsset欠落の拒否を確認した。

English. Download a single bundle containing the verified manifest, pinned Record and Source contents, and retained Asset originals. SHA-256 covers each file and the response. The synchronous limit is 32 MiB decoded. Missing provenance, objects or integrity checks prevent a successful download.

简体中文。可以下载包含已验证清单、固定记录与来源版本、以及保留资产原件的单个复现包。每个文件和整个响应均提供 SHA-256。同步下载上限为解码后 32 MiB。缺少来源信息、对象缺失或完整性校验失败时，下载会被拒绝。
