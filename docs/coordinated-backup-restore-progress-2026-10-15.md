# Coordinated backup / restore — 2026-10-15

## 日本語

🟢 [Done] **G0.5b2 協調backup／restore:** ローカルCompose環境のDBと設定済みbucketを一つのbundleへ保存し、独立したPostgreSQL／MinIOへ復元するコマンドを追加した。復元後、全アプリテーブルの件数・内容SHA-256、objectのbyte数・SHA-256、DBの参照関係を照合する。schema変更はない。

### 操作

リポジトリrootでBun・Docker Composeを使用する。現在のコードで`docker compose build api worker minio`を実行し、PostgreSQL／MinIOを起動済みにしておく。取得中はAPI・Workerを停止するメンテナンス方式。別のone-offコンテナ、直接SQLクライアント、S3管理クライアント等による書き込みも止める。外部writerを自動制御するonline backupではない。

```sh
mkdir -p backups
# 新しい出力先のみ。既存・途中失敗したdirectoryは上書きしない。
bun scripts/coordinated-backup.js backup "$PWD/backups/example-20261015"
bun scripts/coordinated-backup.js verify "$PWD/backups/example-20261015"
# 新しい隔離プロジェクトのみ。既存DB・bucket・volumeは上書きしない。
bun scripts/coordinated-backup.js restore "$PWD/backups/example-20261015" sara-restore-example-20261015
# 復元済み環境を再検証する（read only）
bun scripts/coordinated-backup.js check-restored "$PWD/backups/example-20261015" sara-restore-example-20261015
```

正常時の最後の結果は`restore: verified`。終了コード0が成功、1が失敗、SIGINT／SIGTERM中断は130。復元先のアプリ／Workerは自動起動せず、portも公開しない。検証後の実運用への切替・認証情報・権限・ネットワーク設定は別作業。試験環境が不要になった場合は、作成したproject名を指定して片付ける。

```sh
docker compose -f docker-compose.restore.yml -p sara-restore-example-20261015 down -v --remove-orphans
```

### 保存と整合性

1. 稼働しているAPI／Workerだけを記録・停止。正常終了・通常の例外・協調的な中断時は、元々稼働していたサービスだけを再開する。停止済みWorkerは勝手に起動しない。`maintenance.json`に停止前の一覧を残す。SIGKILL・ホスト停止・Docker障害では再開を保証できないため、この一覧を見て手動復帰する。
2. `auth`／`dataset`／`memory`／`training`／`system`／`drizzle`の全アプリテーブルをUTC・C順序・repeatable-readでfingerprint化し、DB参照も検査する。`pg_dump -Fc --no-owner --no-acl`でDBを保存する。
3. bucketの全現行objectをinventoryに列挙し、streamで保存する。未知objectも保全する。object keyをローカルpathへ直接使わず、keyのSHA-256をファイル名にする。
4. 原本・Import・完了Export・完了Snapshotのmanifest等はDBに記録されたhash／sizeとも照合。Event JobはJSON payloadのbatch UID・件数・正規化events hashも照合する。Snapshotの版参照は現在版への更新とは分けて保持する。
5. DB fingerprintを取り直し、取得中のDB変更があれば失敗する。全file checksumと必要objectを検査した後だけ`COMPLETE`を作る。元サービスの復帰に失敗した場合も非0終了で報告する。
6. 復元前にbundle内全fileを検査し、不正path・重複・symlink・欠損・改変を拒否する。新規の`sara-restore-*` prefixのprojectのみを使用する。既存projectのコンテナやvolumeがあれば拒否する。
7. 別volumeのDBを`pg_restore --exit-on-error`で復元し、元と同じbucket名へobjectを戻す。復元後はbundleと同じfingerprintと全object hashであることを再確認する。

未確定uploadや削除済み原本は、現物があれば保存するが、現物が存在しないこと自体を有効原本の欠損とは扱わない。有効なready原本・永続Jobの入力・完了済み出力は必要objectとして扱う。queued Exportは未生成outputを要求しない。既発行PUT URLはDB・bucketを跨いだtransactionでは停止できないため、一時uploadが遅れて完了する可能性は残る。ready原本は署名PUTの対象と分離済みで、hashを検証する。再開後は既存のAsset照合コマンドで再出現を回収する。

bundleの正本は`manifest.json`、`database.dump`、`objects/*.bin`、`COMPLETE`。`state.json`／`inventory.jsonl`／`maintenance.json`は診断用。bundle directoryを0700、機密fileを0600で作成し、ホストと同じUIDで書き込む。DB dumpには本文・認証情報のhash・その他の私的データが含まれる。`backups/`はGitから除外する。暗号化・署名・別拠点保管・S3のACL／version履歴／保持policy・PostgreSQL global roleはこの形式の対象外。checksumは改変の認証ではなく破損検出であり、信頼するbundleを利用する。

現在はこのrepoのローカルCompose（PostgreSQL 16、単一の設定済みbucket）を対象とする。別bucketのAssetが存在する場合は部分成功にせず拒否する。Managed PostgreSQLや別provider、本番権限・NFS等を同じ手順で扱えるとはみなさない。復元時に自動migrationは行わず、互換のある同じコード・schemaで検証する。カスタムschemaや外部systemの参照保証は対象外。

### 検証

```sh
bun test
bun scripts/test-coordinated-backup.js
```

単体・共有契約は20 pass／17 skip（外部環境試験は無効）。既存API試験29件と、新規bundle単体2件も固定Bun版で成功した。

開発データは38テーブル・22objectで別projectへ復元し一致した。専用fixtureはAPIで作成した承認版・後続訂正・不変Snapshot・Asset binding・Memory Relation／Evidence・Import／Export／Event Jobを含む。38テーブル・28objectの復元、復元先object破損・polymorphic参照破損・DB内容改変の拒否、bundle改変／必要object欠損の拒否、既存出力先／復元先の拒否、原本欠損時の失敗とAPI復帰を確認した。SIGTERM時にも元API／Workerの状態へ戻し、完了印を作らないことを別途確認した。private fileのUID、same-size改変、不正pathとsymlinkも検証した。CIでは同じdrillを実行し、作成したfixtureと復元volumeを後処理する。

🟠 [Next] G0の残る長時間Worker処理中の実kill試験。その後G1の出典revisionと訂正の伝播へ進む。

⭕️ [Pending] 本番provider・別物理host・実権限・実データ量での復元、RPO／RTOの実測、暗号化・保管運用の確認。

## English

🟢 [Done] G0.5b2 provides offline coordinated DB/object backup, isolated restore and post-restore reference/hash verification. Use the four commands above from the repository root after building the API, Worker and object-store images. PostgreSQL and MinIO must be running. All external SQL/S3/one-off writers must also be quiesced; this is not an online distributed snapshot.

Backup records and stops only running API/Worker services, creates a custom PostgreSQL dump and streams every current object from the configured bucket. It fingerprints all application tables, validates required object hashes/sizes and Event Job payload hashes, then checks DB stability again. `COMPLETE` is written only after validation. Normal errors and cooperative cancellation attempt to resume previously running services; hard kill, host failure or Docker failure require manual recovery using `maintenance.json`. A previously stopped Worker stays stopped.

Restore requires a fresh `sara-restore-*` project and separate volumes, validates every input file before creating the environment, restores the DB and original bucket name, then compares all table fingerprints, polymorphic/version references and object hashes. The application/Worker never start automatically and no ports are published. `check-restored` repeats read-only validation. Exit 0 means success, 1 failure, 130 interruption.

Pending uploads and absent deleted originals are distinguished from required ready originals and durable Job payloads/completed outputs. Late staging PUT can still finish; ready originals are separate and hash checked, and the reconciliation command handles reappearance afterward. Existing archives/projects are not overwritten. Unsafe paths, symlinks, duplicate entries, missing files and checksum mismatches fail closed.

Bundles contain private DB/object data: directory 0700, files 0600, host UID ownership; `backups/` is Git-ignored. Checksums are not signatures. Encryption, off-site retention, S3 ACL/version/policy backup, PostgreSQL global roles, custom schemas, other providers and promotion to production are outside this implementation. Use trusted bundles and matching code/schema. Restoration does not run migrations automatically.

The development drill restored 38 tables / 22 objects. The richer fixture restored 38 tables / 28 objects, including an approved old version, later correction, immutable Snapshot, Asset, Memory evidence and durable jobs. Corrupt restored objects, broken references, altered DB rows, damaged bundles, missing required objects, overwrite attempts and missing-source failure/resumption were tested. Cooperative SIGTERM recovery, private ownership, same-size corruption and unsafe/symlink paths were also checked. CI runs the same drill and cleans only its own fixtures/volumes.

🟠 [Next] Kill a long-running Worker mid-operation, then G1 source revisions and correction propagation.

⭕️ [Pending] Production-provider/off-host restoration, actual permissions/data scale, measured RPO/RTO and encrypted storage operations.

## 简体中文

🟢 [Done] G0.5b2实现离线DB／object协同备份、隔离恢复及恢复后的引用／hash验证。在repo root先构建API、Worker及object-store镜像，再使用上方四条命令。PostgreSQL／MinIO须已运行，外部SQL／S3／one-off写入也须停止；这不是在线分布式snapshot。

备份只记录并停止正在运行的API／Worker，保存PostgreSQL custom dump及配置bucket的全部当前object。计算应用表fingerprint，核对必要object的hash／size及Event Job payload，再确认DB未变更。全部验证完成后才生成`COMPLETE`。普通异常及协作式中断会尝试恢复原先运行的服务，原先已停止的Worker不会启动。硬kill、host或Docker故障须参考`maintenance.json`手动恢复。

恢复仅允许新的`sara-restore-*`项目和独立volume。创建前验证全部输入，恢复DB及原bucket名称，再核对表fingerprint、polymorphic／版本引用和object hash。不自动启动应用／Worker，不发布port。`check-restored`可重复只读验证。退出码0为成功，1为失败，130为中断。

未完成upload及已删除原本与必要ready原本／持久Job输入／完成输出分开处理。进行中的PUT可能迟到；ready原本已分离并核对hash，恢复运行后可用既有核对命令回收再出现对象。不覆盖既有bundle／项目，拒绝不安全path、symlink、重复项、缺失及checksum不符。

bundle包含私有数据；目录0700、文件0600，并使用host UID，`backups/`已排除Git。checksum不是签名；加密、异地保管、S3 ACL／version／policy、PostgreSQL global role、自定义schema、其他provider及生产切换不在本次范围。须使用可信bundle及匹配的代码／schema，不自动migration。

开发数据38张表／22个object已恢复一致。专用fixture包含审核旧版本、后续订正、不变Snapshot、Asset、Memory证据及持久Job，38张表／28个object也一致。已验证恢复后的对象损坏、引用破损、DB内容改动、bundle破坏、必要对象缺失、覆盖拒绝，以及源原本缺失时失败并恢复服务。另验证SIGTERM、私有权限、同尺寸改动及不安全／symlink path。CI执行同样drill并仅清理自建fixture和volume。

🟠 [Next] 长时间Worker处理中途kill，然后进入G1来源revision及订正传播。

⭕️ [Pending] 生产provider、其他物理host、实际权限／规模下的恢复，RPO／RTO及加密保管运维验证。
