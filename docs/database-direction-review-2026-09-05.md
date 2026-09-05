# 新しい知識データベースとしての評価と設計方針

確認日: 2026-09-05。対象: このリポジトリのAPI、schema／migration、Worker、管理画面、Compose、テスト、設計・研究資料。関連プロジェクトの実装、商用需要、実データでの検索性能は未検証。本書は方針変更であり、以下の不足機能を実装済みとはしない。

## 判断

**継続する価値はある。ただし、次の開発目標を「根拠と訂正を扱えるAI向け知識DBの実証」に限定する。**

現在の実体はPostgreSQL上のドメインAPIと保存・運用基盤であり、新しいストレージエンジン、クエリ言語、分散DBではない。この位置づけでも独立したDB製品は成立し得る。ユーザーが必要とする保存・検索・訂正・再現の契約を一貫して提供できることが条件になる。

最も有望な価値仮説は「ある回答や学習データがどの版の証拠から生まれたかを説明でき、証拠の訂正後に古い派生知識を使い続けない」こと。Record Version、Evidence、Snapshot、Training Runが既に存在するため、既存実装を活かして検証できる。

一方、SNN、自己組織化、構造因数分解、Fractal Canopyが成功することをDB製品の成立条件にすると、検証までの距離と不確実性が大きすぎる。研究は継続候補として保存し、DBのリリース条件から分離する。独自性・優位性・商業的成立は現時点では未証明。

| 観点 | 評価 | 判断の根拠 |
| --- | --- | --- |
| 保存基盤としての可能性 | ある | PostgreSQLのトランザクション、Record本文の版履歴、監査、Snapshotを利用済み |
| AI知識DBとしての可能性 | 条件付きである | Evidenceから訂正・検索・利用履歴までつなげられる設計資産がある |
| 汎用DBエンジンとしての新規性 | この実装では示していない | 保存・索引・並行制御の土台はPostgreSQL。独自エンジンを作る必然性の証拠がない |
| 本番運用の準備 | 未完了 | 整合性の抜け、障害復旧・負荷・バックアップ復元の今回の実証がない |
| 市場性 | 未検証 | 外部利用者の継続利用・導入工数・支払意思を測っていない |

## 既存技術との位置づけ

「モデル外に記憶する」「関係と時刻を保存する」「検索で取り出す」だけを新規性としない。

| 比較対象 | 公式資料で確認できる能力 | SARAで実証すべきこと |
| --- | --- | --- |
| PostgreSQL + pgvector | ベクトル検索と全文検索の併用 | 素朴な同構成に対して、訂正後の根拠整合性と運用工数が改善するか |
| Graphiti | 時系列の知識グラフ、増分更新、hybrid search | 版に固定したレビューからDataset／Runまでの追跡と訂正管理が実利用で有利か |
| Mem0 | 既存memoryの更新 | 更新APIがあるだけでなく、派生物の失効と過去利用の説明まで保証できるか |

根拠: [pgvector公式](https://github.com/pgvector/pgvector)、[Graphiti公式ドキュメント](https://help.getzep.com/graphiti/getting-started/welcome)、[Mem0 Update Memory](https://docs.mem0.ai/core-concepts/memory-operations/update)。確認日はいずれも2026-09-05。競合に機能が「ない」とは断定せず、同一条件での比較を行う。ベンダー公表性能をSARAの性能証拠には使わない。

## 実装を確認できた資産

- 認証、API key scope、ロール、refresh rotation、HMAC取り込み。
- Source／Record CRUD、Record本文の版追加とexpected_version競合検出、同一トランザクションの監査。
- Tag、Annotation、Evaluation、Version固定のレビュー入口。
- 同期／非同期Import・Export、PostgreSQL Job、MinIO保存、Worker claim。
- Dataset Definition、Record Versionを固定したSnapshot、manifest、Training Runと追記Metric。
- Event／Experience／Entity／Concept／Relation、Alias、追記Evidenceと検証判断、上限付き探索。
- Asset予約、署名URL、サイズ・hash照合、provenance binding。

これらの存在は、全経路での不変性・権限整合性・耐障害性を保証しない。特に「Record本文の過去版」と「出典・承認・添付も含む知識全体の過去状態」は区別する。

## 優先的に解消する問題

### 1. 承認と版が全書き込み経路で結びついていない

`apps/api/src/routes/records.js`の入力schemaは`approved`を受理し、一般作成・PATCHは`records:write`で通る。承認済みRecordの本文を更新してstatusを省略すると、親の`approved`が残る。同期ImportとWorkerのnormalizerにもstatusの取り込みがある。一方、レビューAPIは固定Versionを対象にしている。

`apps/api/src/routes/memory.js`の汎用PATCHも、現在行と入力をmergeして同じ行を更新する。verifiedの内容を変更しても、以前の検証状態が残り、expected revisionもない。並行PATCHは別fieldの変更でも古い値を書き戻し得る。

**結果:** 「承認済みを取り出す」が「その内容が承認された」を意味しない。Datasetのstatus filterだけでも保証できない。

**方針:** 一般書き込みはdraft／candidateを生成し、承認は対象revisionに固定した判断だけから決める。新revisionは未承認とする。手動承認済みImportが必要なら、専用権限・理由・対象版の監査を伴う明示経路にする。同期・非同期・管理APIは同じ検証と状態遷移サービスを使う。

### 2. 出典参照が「当時の証拠」まで固定されていない

`record_versions`は本文等を保持するが、`source_id`、title、language、metadata等は親Recordにある。Source自体も更新可能。`memory.relation_evidence`はtype／ID参照で、対象revisionへの必須参照がない。検証判断もtarget IDと状態が中心で、内容revisionに固定されていない。

**結果:** 根拠の本文や出典属性が変わっても、既存Evidence／verified Relationと整合するとは限らない。現行manifestはVersionの参照一覧であり、出典・権利・Assetまで含む自立した再現bundleではない。

**方針:** Source revision、Memory revision、version-bound Evidence／Decisionを順に導入する。内容と解釈に必要な属性を同一revisionへ固定し、明示的な依存関係からstale判定と再検証へつなぐ。内容hashだけを変更検出の仕組みとせず、依存するrevision IDを保存する。

### 3. 共有範囲と所有者モデルが統一されていない

Record／Source一覧とExport・SnapshotのRecord選択は共有コーパスに近い条件であり、Memory、Asset、Dataset定義は所有者で絞る。これは単一組織内の共有という意図なら直ちに不正アクセスの証明にはならないが、個人・projectごとの隔離を期待して利用すると契約が一致しない。

さらに`memory.js`の`validateNode`は全tableに`createdBy`がある前提だが、`dataset.records`は`ownerId`を持つ。DB接続なしのDrizzle SQL生成で、Record参照の条件に`and  = $2`が生じることを確認した。RecordをノードまたはEvidence参照にする経路は優先修正対象。

**方針:** 初期製品は単一組織・明示workspace共有とし、membershipとロールで共同レビューを可能にする。`created_by`は作者、`workspace_id`はアクセス境界として分離する。全読書き・Export・Snapshot・Job・Asset参照で同じ認可を適用する。SaaSの複数組織隔離を宣言するのは境界テストの通過後。

### 4. SKIP LOCKEDだけでは再実行の安全性を保証できない

`apps/worker/src/index.js`は起動時にstarted_atが5分より古いJobをqueuedへ戻す。heartbeat／lease期限／claim世代がなく、更新もworker_idやclaim世代を条件にしていない。正常に長時間稼働するWorkerがいる間に別Workerを起動すると、同じJobを再claimし、旧Workerが進捗・最終状態を更新できる可能性がある。これは障害注入では未再現の静的所見。

またループの`redis.rpop`とDB claimが同じtryにあり、Redisが例外になるとその周回のDB pollingまで到達しない。「通知はヒントでDBが正本」という設計と不一致。Import優先の固定順序にも他Jobの待ち時間を評価する必要がある。

**方針:** at-least-once実行と冪等な効果を契約にする。lease、heartbeat、fencing token（claim世代）、上限付きretry、定期reaperを追加し、全進捗・成果物確定を有効なclaimに限定する。Redis停止でもDB claimを続け、Job種別間の公平性を測る。

### 5. Assetのreadyと不変保存が同じ意味になっていない

`apps/api/src/routes/assets.js`は署名PUTと配信用GETで同じobject keyを使う。complete時にhashを検証するが、署名PUTの有効期間中の再PUTや検証中の変更に対し、確定object versionを固定していない。またDELETEはDBの論理削除後にobjectを削除し、失敗時はlogのみ。

**方針:** 一時uploadと確定objectを分離し、確定版のhash・object versionを検証してから公開する。Snapshotや証拠から保持されるobjectは参照保持policyに従う。撤回・利用停止と物理消去を区別し、物理消去は再試行可能なJobにする。法的消去等では内容を残すと約束せず、消去済みtombstoneと再現不能理由を返す。DBとobject storage間に単一ACID transactionがあるとは扱わない。

### 6. 保存後に使うための検索契約が不足している

pgvector拡張は有効化する構成だが、現在のschemaにEmbedding列・索引・検索APIはない。Record一覧はstatus／type filter、Memory一覧はlimit中心でcursorがない。bounded traversalは実装済みだが、候補取得の内部limitによる省略を既存のnode／edge上限フラグだけで完全には説明できない。

**方針:** 日本語・英語・简体中文の字句検索、版付きEmbedding、関係探索を共通retrieval契約で扱う。権限、時点、検証状態、根拠revision、truncation理由を返す。現在のtraverseはcandidateも含むため、承認済み利用向けAPIを分け、既存APIの意味を黙って変えない。

### 7. 実装速度に対して、検証と運用の完成条件が弱い

API routeに入力検証・SQL・状態遷移が集まり、WorkerにCSV／Record検証の別実装がある。OpenAPIは主にsummaryと拡張属性で、完全なrequest／response schema契約ではない。統合テストは大きな1ケースで、通常の`bun test`ではskipされる。管理画面は3言語の説明skeletonで、実際の編集・レビュー導線ではない。

**方針:** 全面書き換えはしない。先に共有domain serviceと入力schemaを抽出し、Record参照・版と承認・複数ユーザー・障害復帰などの独立した回帰テストを設ける。必要な型検査を段階導入する。CIで一時DBに全migrationを適用し、実Worker・object storageを含む統合試験を必須にする。バックアップ／復元は最後の付録から初期gateへ移す。

## 採用するデータ契約（未実装の目標）

1. **正本:** PostgreSQLに知識・revision・判断・依存関係・Job状態。バイナリはobject storage。検索index、cache、Embeddingは再構築可能な派生物。
2. **識別:** `workspace + logical ID + revision ID`を分離。最初は既存Record／Memoryを拡張し、汎用EAVや全対象共通の巨大tableへ一度に移さない。
3. **時間:** 世界で有効な期間（valid time）とシステムが知った時点（recorded time）を分離。訂正は過去revisionの上書きではなく、新revisionとsupersedes／retractionとして記録する。
4. **検証:** Decisionはrevisionに固定。verifiedは真理の証明ではなく、そのpolicy・根拠・時点の判断。内容更新と依存先変更に対する再検証を区別する。
5. **訂正:** revision追加と変更通知outboxを同一DB transactionで確定。依存先の再計算は非同期。索引更新前でもstrict retrievalは最新revision・依存先の有効性を確認し、古いものを返さず不足を明示する。
6. **利用:** retrieval結果は対象revision、根拠revision、判断、時点、policy版、index watermark、打ち切り理由を含む。利用traceから後で影響対象を列挙できる。
7. **再現:** 過去Snapshotは書き換えず、失効・権利変更・訂正の影響を別記録にする。既に学習済みのモデルの重みや外部へコピーされた回答が自動訂正されるとは約束しない。Runの影響表示と再学習判断を提供する。

最初の実証シナリオは、三言語の製品仕様・運用手順コーパスで行う。「仕様Aをv1からv2へ訂正 → v1依存のRelationをstaleと判定 → 新しい回答はv1を採用しない → 過去SnapshotとRunはv1利用を説明できる」を、二つの独立したクライアントで再現する。

## 移行方法

- 最初に既存データのbackupと復元を試す。既存UID・Record Version・Snapshot IDは維持する。
- workspaceを追加し、既存共有Record／Sourceと個人Memoryの移行先を対応表にする。所有者不明は隔離し、勝手に公開しない。
- 新しいrevision／dependency列・tableを追加してbackfillする。復元できない過去の出典や検証版は`legacy_unpinned`等で識別し、verifiedへの推測変換はしない。
- 旧APIの読み取り互換期間を設ける。旧書き込みも共有serviceへ通し、承認状態の直書きは明示エラー・移行案内へ変える。新しい厳格検索は版付きAPI契約で提供する。
- shadow readで件数・参照・権限・結果差分を照合して切り替える。問題時は機能flagで旧読取へ戻し、新規revisionを破壊するdown migrationに頼らない。

## 本番配置

本番の第一候補はXServer VPS CloudのApp VPS + Managed PostgreSQL + NFSを中心に、通常VPSのAI／crawler Workerを分離する構成。Cloud内のDB writer Workerは直接DBを利用できるが、通常VPS WorkerはHTTPS APIでJob取得・結果送信し、短命の署名URLでAssetを扱う。通常VPSからManaged DBへの接続を前提にしない。

NFSは共有一時ファイル・交換領域として位置づけ、現在のS3 APIをNFS mountへそのまま置換しない。確定Assetはobject storage APIの背後に保持し、ストレージ実装は耐久性と復元試験で選ぶ。NFS上のMinIO運用をこの文書だけで認定しない。

公式資料ではCloudのDB／NFSとプライベート接続は確認できるが、必要な`vector`等の拡張、権限、PITR・復元粒度はこの調査では確定できていない。導入gateで確認する。非対応ならCloud内自主管理PostgreSQL案または再構築可能な検索service案を比較し、未確認のManaged拡張へ実装を依存させない。[DBサーバー仕様](https://vpscloud.xserver.ne.jp/functions/db_server/)

NFSは任意復元可能なバックアップ機能がないため、共有ストレージの存在をbackupとみなさない。DB・object・manifestを照合する独立backupと復元訓練を用意する。[NFS仕様](https://vpscloud.xserver.ne.jp/functions/nfs/)（いずれも2026-09-05確認）

## 今回の検証と限界

- `bun test`: **9 pass / 1 skip / 0 fail、19 assertions**。skipはDB等を使う統合テスト1ケース。
- `docker compose ps`: 稼働サービスなし。今回、実DB統合試験・障害注入・復元・負荷試験は実行していない。過去のprogress文書の成功記録は今回の再検証と区別する。
- DrizzleのSQL生成: Recordに`createdBy`がなく、不正な条件が生成されることをDB非接続で確認。
- その他の障害シナリオは実装からの分析であり、発生頻度や損失件数は未測定。
- 本変更は方針・roadmap・設計資料の更新のみ。指摘したruntimeの修正は[現行Roadmap](roadmap.md)に未完了として登録する。

## English summary

Continue as a PostgreSQL-based knowledge database with revision-bound evidence, review, correction propagation, and reproducible dataset usage. A new storage engine and superiority over existing memory systems are not demonstrated. Prioritize approval/revision integrity, consistent workspace access, safe job recovery, and immutable assets before retrieval benchmarks. Keep neural architecture research outside the database release gates. This review changes documentation only; runtime findings remain open. Tests: 9 passed, 1 integration case skipped.

## 简体中文摘要

建议继续开发以 PostgreSQL 为基础的知识数据库，重点是将证据和审核绑定到具体版本、传播更正影响，并重现数据集的使用历史。目前尚未证明新存储引擎的必要性或相对于现有记忆系统的优势。应先修复审核与版本一致性、工作空间权限、任务恢复和资源不可变性，再比较检索效果。神经网络架构研究不作为数据库发布条件。本次仅更新文档，运行时问题仍待修复。测试结果为9项通过、1项集成测试跳过。
