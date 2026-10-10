# Asset retention and integration isolation — 2026-10-11

## 日本語

🟢 [Done] **G0.3b:** 巨大な`integration.test.js`を撤去。Recordの出典／タグ／監査と品質Reviewを別ケースへ分割し、Memoryの同期・署名取り込み、Worker取り込み、グラフ／根拠／Verificationも独立した。各ケースは認証と参照先を自分で用意する。共通fixtureは返却IDをassert前に登録し、LIFOで後処理を継続する。Memoryの途中失敗を意図的に起こし、Workerを取消または終端まで待って、生成Event・Batch・Job・object・Sourceを回収する試験を追加した。共有タグを他Recordから外さない。

🟢 [Done] **G0.5a:** bindingが残るAssetは`409 ASSET_IN_USE`で保持する。Source／Record／Eventの論理削除はbindingを消さず、復元時の参照を保持する。admin／editorがbindingを明示的に外してからAssetを論理削除する。論理削除とJob作成は同じDB transactionで確定し、API内の一回限りのobject削除を撤去した。

原本は`ASSET_RETENTION_SECONDS=86400`（既定24時間、許容600〜31536000秒）保持する。既発行download URLは5分の有効期限内なら論理削除後も利用可能。一時uploadは予約から600秒（PUT URLの300秒＋猶予300秒）以降に回収する。確定済みの原本は一時uploadの回収と独立して保持する。complete／binding解除／論理削除はAsset行lockで直列化する。

`dataset.asset_deletion_jobs`が正本。原本と一時uploadのobject keyごとに一意の要求を残す。WorkerはPostgreSQL pollingで取得し、`FOR UPDATE SKIP LOCKED`、claim世代、lease／heartbeat、指数的retry（最大1時間の間隔）を使用する。削除の直前にAsset状態、bucket、key、binding、保持期限を再検査し、Asset／Jobのlockをobject削除と完了記録の間保持する。古いclaimはobjectへ触れない。object削除後にDB確定できず再実行しても、存在しないkeyのDELETEは成功扱いで完了できる。

retry上限は`JOB_MAX_ATTEMPTS`（既定3）。上限到達時は`failed`とエラーを残し、adminの明示retryで再開する。claim世代はresetしない。APIは`assets:read`／`assets:write` scopeに加えてworkspace roleを検査する。

| API | role / behavior |
| --- | --- |
| `DELETE /api/v1/assets/:id/bindings/:bindingId` | admin／editor。bindingを明示解除。旧版の削除済みAssetのbindingも対象 |
| `DELETE /api/v1/assets/:id` | admin／editor。参照がなければ論理削除とJobを確定。再送は同じAssetの成功応答 |
| `GET /api/v1/assets/:id/deletion-jobs` | admin／editor。削除済みAssetも進捗閲覧可能 |
| `POST /api/v1/assets/:id/deletion-jobs/:jobId/retry` | adminのみ。failedのみ再開。保持期限は短縮しない |

migration `0028_living_madame_masque.sql`は追加table／index／制約と旧AssetへのJob登録。既存objectやAsset metadataを消さない。旧削除済みAssetの原本には新たに24時間の保持を置く。旧ready Assetの一時uploadは新たに10分待つ。旧削除済みAssetでもbindingが残る原本はWorkerが拒否し、明示解除後にretryする。

検証コマンド:

```sh
bun test
bash scripts/test-job-recovery.sh
bash scripts/test-asset-deletion-recovery.sh
docker compose run --rm -e RUN_INTEGRATION=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test
```

ローカル単体・共有契約は18 pass／16 skip（外部環境試験は無効）。全API統合試験は29 pass／1 skip／0 fail、527 assertions。skipは通常Worker停止が必要な障害注入ケースで、専用scriptが別途実行し、1 pass／0 fail、42 assertionsを確認した。既存Job復旧scriptも成功。migration前に開発DBをpg_dumpで退避し、別の一時DBへ復元して0028までのmigration適用を確認し、一時DBを削除した（object復元ではない）。通常Workerによる一時uploadと原本の回収、ストレージ失敗からのretry、旧claim排除、dead lease復旧、retry上限、権限、参照中／有効Assetの保護、削除済みkey再実行を検証した。

🟠 [Next] **G0.5b:** 孤立object照合、長時間PUTの期限後到着の再照合、DB＋objectを組み合わせた復元手順。600秒の猶予は、開始済みPUTが任意の時間後に完了する場合の再生成までは保証しない。廃棄済み元データの復元、法的保持、保持期間中のAsset restore API、未確定uploadの自動期限切れは今回の実装に含まない。

⭕️ [Pending] 別の本番環境でのDB＋object復元・hash整合検証。今回の開発DB単独の復元確認とは区別する。

## English

🟢 [Done] G0.3b: Removed the monolithic integration case. Record provenance/tags/audit, quality Review, synchronous/signed Memory ingestion, Worker ingestion and graph/evidence/verification have independent cases and fixtures. IDs are registered before assertions; cleanup continues in reverse order. An injected Memory failure verifies job settlement and removal of generated rows and objects without removing other Records' shared tag links.

🟢 [Done] G0.5a: Bound Assets cannot be deleted, even when targets are soft-deleted. After explicit detachment, logical deletion and durable per-object jobs commit together. Originals remain for 24 hours by default (`ASSET_RETENTION_SECONDS`, minimum 600 seconds); staging cleanup waits 600 seconds after reservation. Existing download URLs can still work until their five-minute expiry. Row locks serialize completion, detachment and deletion.

Worker polling uses PostgreSQL, SKIP LOCKED, fenced generations, leases, bounded exponential retries, and state/key/bucket/reference checks immediately before deletion. Asset/job locks span storage deletion and DB completion. Missing-object DELETE is idempotent. Exhaustion remains failed and visible; only admins may restart it, without resetting generation or shortening retention. The API table above defines the four routes. Migration 0028 creates jobs for legacy Assets without deleting bytes or metadata, with a fresh 24-hour window for deleted originals and ten minutes for ready staging.

Validation: 18 local unit/shared-contract tests pass; full API integration 29 pass, one recovery case skipped, 527 assertions. The skipped case runs separately with the regular Worker stopped: 1 pass, 42 assertions. The pre-migration development DB dump was restored to a temporary database, migrated through 0028, and the temporary database removed; this is not object-store recovery. Existing job recovery also passes. Retention, normal Worker cleanup, injected storage errors, stale claims, expired leases, exhaustion, permissions, active/referenced Asset protection and repeat deletion are covered.

🟠 [Next] Orphan reconciliation, late completion of long-running PUT requests, and coordinated DB/object restore. Grace cannot prevent arbitrarily late in-flight PUT completion. Asset restore, legal holds and automatic expiry of unfinished reservations are outside this change.

⭕️ [Pending] Production-environment DB/object restoration and hash matching, distinct from the development DB-only restore check.

## 简体中文

🟢 [Done] G0.3b：移除大型集成测试。Record来源／标签／审计、质量审核、Memory同步及签名导入、Worker导入、图谱／证据／验证均有独立用例和fixture。断言前登记ID，逆序清理并继续处理其他资源；通过故意触发Memory失败验证Job终止及生成数据／对象回收，不移除其他Record共享的标签关联。

🟢 [Done] G0.5a：有binding的Asset不可删除，即使引用目标已软删除。显式解绑后，逻辑删除和按object持久化的Job在同一事务提交。原本默认保留24小时（`ASSET_RETENTION_SECONDS`，最短600秒）；临时上传在预约后600秒才清理。已发出的下载URL可在5分钟有效期内继续使用。行锁串行化确定、解绑和删除。

Worker通过PostgreSQL轮询、SKIP LOCKED、claim世代、lease、有限指数重试处理任务；删除前重新检查状态、key、bucket、引用和保留时间，并在对象删除至DB确认期间持有Asset／Job锁。对不存在key的删除可重复执行。耗尽重试后保留failed和错误，仅admin可重新启动，不重置世代或缩短保留期。新增API见上表。migration 0028仅添加表和历史任务，不删除原数据；历史已删除原本重新保留24小时，ready临时上传等待10分钟。

验证：本地单元／共享契约18项通过；API全量集成29项通过、1项跳过、527次断言。跳过项需停普通Worker，通过专用脚本独立运行（1项通过，42次断言）；已将migration前的开发DB备份恢复到临时DB并适用0028，再删除临时DB；这不是对象存储恢复。原有Job恢复也通过。覆盖正常回收、存储错误重试、旧claim、lease恢复、重试上限、权限、有引用／有效Asset保护及重复删除。

🟠 [Next] 孤立对象核对、长时间PUT过期后完成的核对、DB及对象协同恢复。宽限期不能保证阻止任意延迟的进行中PUT。Asset恢复、法律保留和未完成预约自动过期不在本次范围内。

⭕️ [Pending] 其他生产环境的DB／对象恢复及hash匹配，与开发环境DB单独恢复确认分开。
