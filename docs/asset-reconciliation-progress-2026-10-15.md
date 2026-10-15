# Asset reconciliation — 2026-10-15

## 日本語

🟢 [Done] **G0.5b1:** DBと実objectの照合、ready原本のsize／SHA-256確認、削除完了後に再出現したobjectの削除Job再開を実装した。schema変更はない。

```sh
# 既定: 報告のみ
bash scripts/reconcile-assets.sh
# 適格な既存Jobの再開（objectの削除自体はWorkerが行う）
bash scripts/reconcile-assets.sh --apply
```

MinIOのinventoryを一時ファイルへ完全に取得してから、APIコンテナで照合する。JSONLを逐次処理し、DBのAssetはUUID cursorで100件ずつ読む。対象bucketはAPIコンテナの`MINIO_BUCKET`（既定`sara-assets`）から取得し、Composeの`.env`設定も反映する。未知objectの判定対象は`assets/` namespaceだけで、Dataset manifest／Import／Exportは対象外。原本hash確認はreadyかつ有効なAssetの本文を順次読むため、保管量に応じてI/Oが発生する。

出力はJSONL。`unowned_object`、`missing_original`、`original_integrity_mismatch`、`storage_error`、`reappeared_object`を区別し、最後に`summary`を出す。存在しないkeyと接続・権限などの障害を混同しない。HTTP 404だけでは欠損と判断せず、bucket不存在もストレージ障害として扱う。終了コードは0＝未解決検出なし、2＝未解決検出／ストレージ障害あり、1＝不正入力やコマンド障害。再開したJobは`summary.requeued`で確認する。コード0も削除完了を意味せず、完了は削除Job APIで確認する。

`--apply`は`completed`かつ保持期限を過ぎたJobのみ対象とする。Asset行をlockし、bucket・key・状態・参照を再検査してから同じJobを`queued`へ戻す。claim世代と保持期限を維持し、今回の再出現に対する試行回数だけ0へ戻す。稼働中・queued・failedのJobは上書きしない。failedは既存の管理者retry APIを利用する。未知object・参照中原本・有効原本を自動削除しない。報告後に参照状態が変わっても、Workerが削除直前に再検査する。

照合は毎回その時点の状態を読み直す。非常に遅いPUTがさらに後で完了した場合は、再度照合する必要がある。自動スケジュールは作成していない。運用の定期点検・障害復旧後の点検で繰り返し実行する。inventoryとDBは単一snapshotではないため、書き込み中の報告は再実行で確かめる。未知objectの廃棄判断や復元判断は自動化していない。

検証:

```sh
bun test
bash scripts/test-asset-deletion-recovery.sh
bash scripts/reconcile-assets.sh
```

専用Docker試験は通常Workerを停止し、実PostgreSQL／MinIOで実行する。署名PUTで一時uploadを再出現させ、reportが変更しないこと、apply後のJob再実行で一時uploadだけが消えること、claim世代が進むこと、重複apply、未知keyの保持、原本の欠損／破損、ストレージ障害、削除済み原本に新たな参照がある場合の保持も確認する。試験fixtureの保持期限だけを進め、実際に10分待った試験とは区別する。CIは既存のAsset復旧stepでこの試験も実行し、全統合試験後にinventoryコマンドも確認する。専用試験は2 pass／0 fail、75 assertions。ローカル単体・共通契約は18 pass／17 skip（外部環境試験は無効）。実inventoryのコマンドも未解決検出0で正常終了した。全API統合試験は29 pass／2 skip／0 fail、527 assertions（skipの2件は前述の専用試験で実行済み）。

🟠 [Next] **G0.5b2:** DB＋objectを組み合わせたbackup／restore、別環境での参照とhash照合、長時間Worker処理の途中kill。今回、復元保証まで完了したとは扱わない。

⭕️ [Pending] 本番環境の保管方式・権限・実データ量での復元試験。

## English

🟢 [Done] G0.5b1 adds Asset inventory/DB reconciliation, ready-original size/SHA-256 checks, and requeueing of objects that reappear after completed deletion. No schema change.

Run `bash scripts/reconcile-assets.sh` for a report, or append `--apply` to requeue eligible jobs. Inventory is fully obtained before changes, streamed as JSONL; DB Assets use 100-row cursor pages. The selected bucket is `MINIO_BUCKET`; only unowned keys under `assets/` are classified. Dataset/import/export storage is outside this command. Hash checking reads ready originals sequentially.

Findings distinguish unowned objects, missing originals, integrity mismatches, storage errors and reappeared objects. Exit 0 means no unresolved findings, 2 means unresolved findings/storage errors, and 1 means invalid input or command failure. A requeued job is not a completed deletion; inspect the deletion-job API for completion.

Apply only reopens completed jobs after retention. Asset locks protect fresh state, bucket/key and reference checks. Claim generations and retention deadlines are preserved; attempts restart for the new appearance. Active/queued/failed jobs are not overwritten, and unowned or referenced originals are not deleted. Failed jobs still require the admin retry API. The Worker rechecks eligibility immediately before deletion.

The scan is repeatable, not a continuous watcher. A still-later PUT needs another scan. Inventory and DB are not one snapshot; rerun findings during writes. No scheduled automation or automatic disposal of unknown keys was created. Real Docker tests cover signed late PUT, report-only behavior, requeue/deletion, generation fencing, repeat apply, unknown-key retention, missing/corrupt originals, outages and fresh references. Only fixture deadlines are advanced instead of waiting ten minutes.

🟠 [Next] Coordinated DB/object backup and restore, reference/hash verification in another environment, and killing a long-running Worker mid-operation.

⭕️ [Pending] Restoration with production storage, permissions and data volume.

## 简体中文

🟢 [Done] G0.5b1实现Asset清单／DB核对、ready原本的size／SHA-256检查，以及已完成删除后对象再出现时重启任务。没有schema变更。

运行`bash scripts/reconcile-assets.sh`仅报告；追加`--apply`才重启符合条件的Job。先完整获取inventory，再逐行处理JSONL；DB按UUID cursor每页100条读取。bucket由`MINIO_BUCKET`指定，未知对象只检查`assets/`，不包含Dataset／Import／Export。hash检查按顺序读取ready原本。

报告区分无DB归属对象、原本缺失、完整性不符、存储错误和删除后再出现。退出码0表示无未解决发现，2表示存在未解决发现／存储错误，1表示输入或命令错误。重启Job不代表已经删除完成，应通过删除任务API确认。

apply只重启已完成且保留期结束的Job。锁定Asset并重新检查状态、bucket／key及引用，保留claim世代和保留期限，仅重置新一次出现的尝试次数。不覆盖运行中／queued／failed任务，不自动删除未知对象或被引用原本。failed仍由管理员retry API恢复。Worker在删除前再次检查。

该命令可反复执行，并非持续监控；更晚完成的PUT需要再次核对。inventory与DB不是同一snapshot，写入期间的报告应再次确认。没有创建定时自动化或未知对象自动销毁。真实Docker试验覆盖签名PUT再出现、只报告模式、任务重启及回收、世代、重复apply、未知key保留、原本缺失／损坏、存储故障及新增引用。仅推进fixture时间，不声称已等待真实10分钟。

🟠 [Next] DB／对象协同backup及restore、其他环境的引用／hash检查、长时间Worker处理中途kill。

⭕️ [Pending] 生产存储、权限与真实数据量的恢复验证。
