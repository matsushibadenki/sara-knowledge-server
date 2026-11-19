# Snapshot再現バンドル / Snapshot reproduction bundle / 快照复现包

🟢 [Done] `GET /api/v1/datasets/:id/snapshots/:snapshotId/bundle` はハッシュ検証済みmanifest、固定Record Versionの本文と文脈、固定Source revisionの内容、保持済みAsset原本を一つのJSONとして取得する。Dataset、Record、Source、Assetの読取権限が必要。

各ファイルはパス、Base64データ、復号後サイズ、SHA-256を持つ。サーバーは保存したmanifestのハッシュとメンバーの版を確認し、Assetのサイズとハッシュをmanifestに照合する。欠落・不一致があればダウンロードは失敗する。レスポンスヘッダー `X-Content-SHA256` はJSONファイル全体のハッシュ。

ダウンロード後は `bun scripts/verify-snapshot-bundle.js FILE [sha256:...]` で検証する。ヘッダーを別に保存して渡すとファイル全体のハッシュも比較できる。外部URL先の本文はSourceレコードに保存された範囲で再現できる。同期取得は復号後の合計32 MiBまで。固定情報が不明なRecordや、Asset保持参照を欠くSnapshotは409を返す。

隔離PostgreSQL、Redis、MinIOでDataset／Training統合試験が成功（85アサーション）。旧版の取得、manifest一致、原本の同サイズ改変と欠落を確認。また、オフライン検証コマンドの正常系とAsset欠落の拒否を確認した。

English. Download a single bundle containing the verified manifest, pinned Record and Source contents, and retained Asset originals. SHA-256 covers each file and the response. The synchronous limit is 32 MiB decoded. Missing provenance, objects or integrity checks prevent a successful download.

简体中文。可以下载包含已验证清单、固定记录与来源版本、以及保留资产原件的单个复现包。每个文件和整个响应均提供 SHA-256。同步下载上限为解码后 32 MiB。缺少来源信息、对象缺失或完整性校验失败时，下载会被拒绝。

## 大容量バンドル / Large bundles / 大型复现包

🟢 [Done] SnapshotのURLに `/bundle-job` を付けてPOSTすると永続ジョブを登録する。同時または反復のPOSTは同じジョブを返す。GETで `queued`、`processing`、`completed`、`failed` を確認できる。失敗後のPOSTは再試行する。完成後に `GET …/bundle-job/download` でNDJSONをストリーミング取得する。生成にはDataset書込権限も必要。

Workerは固定版をDBカーソルで読み、Assetをチャンクで読み出す。SHA-256・サイズを照合しつつ一時ファイルへ書き、検証後に単一並列のmultipart uploadでobject storeへ保存する。完成バンドル全体はメモリに展開しない。manifestの解析は32 MiBまでで、RecordとSourceは行単位で扱う。一時ディスクにはエンコード済みバンドルを置く空き容量が必要。Workerを強制終了した際の一時ファイルと未参照objectは運用上の回収対象。ジョブはlease切れ後に再取得し、世代が一致したWorkerだけが成果物を公開する。

ダウンロード時の `X-Content-SHA256` を別途保存し、`bun scripts/verify-snapshot-stream.js FILE sha256:...` で照合する。検証コマンドもファイル全体をメモリに載せず、各ファイルのサイズとSHA-256、完了マーカー、全体のSHA-256を確認する。NDJSONは `bundle`、各ファイルの `file`・Base64 `data`・`end`、最後に `complete` のフレームで構成する。`records.jsonl` と `sources.jsonl` は復号後も行単位で処理できる。

English. POST the bundle job, poll its GET endpoint, then stream the completed NDJSON from its download endpoint. The worker uses bounded chunks, temporary disk and multipart upload. Verify with the independently retained response SHA-256. The manifest parser still has a 32 MiB metadata limit.

简体中文。提交异步任务后查询状态，完成后流式下载 NDJSON。Worker 使用分块读取、临时磁盘与分片上传。请独立保存响应的 SHA-256，用验证命令同时核对每个文件和整个复现包。清单元数据仍限制为 32 MiB。

検証。33 MiBのAssetを含む統合試験を実WorkerとMinIOで実行し、重複POST、生成完了、配信サイズ、全体SHA-256の一致を確認した。検証コマンドの分割フレーム、同サイズの改変、途中切断、全体hash不一致は単体試験で確認した。大容量統合試験をCIに組み込んだ。
