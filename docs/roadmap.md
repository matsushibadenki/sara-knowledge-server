# Roadmap

更新: 2026-10-22。[設計評価と方針](database-direction-review-2026-09-05.md)に基づく。進捗と実装順序の正本は本書。過去のprogress文書と[改訂前の全項目](roadmap-archive-2026-09-05.md)は履歴であり、そこにあるNextは現在の着手指示ではない。

- 🟢 `[Done]` implemented in the current codebase
- 🟠 `[Next]` high-priority unfinished work
- 🔴 `[Later]` planned, but not the closest next step
- ⭕️ `[Pending]` cannot be tested in the development environment; on hold

Doneは機能の存在を示し、本番品質・全経路の正しさを保証しない。2026-09-12にG0.4のlease切れ、retry上限、旧claim遮断、Redis停止時DB polling、Job種別公平性をDockerで確認した。各gateは以下の受け入れ試験を実行し、結果を保存するまで未完了とする。

## 製品目標

**根拠・版・検証・訂正・学習利用履歴を一貫して扱うAI向け知識DB。** PostgreSQLを保存エンジンとして維持する。最初は単一組織内のworkspace共有を対象に、製品仕様・運用手順の訂正を2種類のクライアントへ反映できることを実証する。汎用DBエンジンやSNN／RISAの研究成功を初期製品の要件にしない。

English: Prove a revision-aware knowledge database with traceable evidence and corrections before expanding research features.

简体中文：先验证版本、证据和更正机制完整的知识数据库，再扩展研究功能。

## 既存の実装資産

- 🟢 [Done] monorepo、Bun + Hono、Next.js三言語skeleton、Docker Compose、固定lockfile build
- 🟢 [Done] PostgreSQL + 拡張、Drizzle schema／migration、Redis、MinIO、Mailpit
- 🟢 [Done] JWT、Refresh rotation、API key scope、ロール、ログイン試行制限、CORS、readiness
- 🟢 [Done] Source／Record CRUD、Record本文Version・競合検出・論理削除／復元
- 🟢 [Done] Source／Record変更の同一transaction監査、admin監査API
- 🟢 [Done] Tag／Annotation／Evaluation、Version固定レビューの入口
- 🟢 [Done] JSON／JSONL／CSV同期・非同期Import／Export、原本・hash・行別結果・冪等キー
- 🟢 [Done] WorkerのSKIP LOCKED claim、chunk進捗、取消、lease／heartbeat、世代fence、上限付きretry、定期reaper
- 🟢 [Done] Dataset Definition、不変Snapshotメンバー、manifest、Training Run／Metric
- 🟢 [Done] Event／Experience／Entity／Concept／Relation、Alias／Evidence／Verification API
- 🟢 [Done] Bulk Event、bounded traversal、HMAC／nonce、501〜10,000 Event非同期取り込み
- 🟢 [Done] Asset upload予約、署名URL、complete時hash検証、provenance binding

## G0 — 整合性と実装契約の修復（開発環境の受け入れ完了）

- 🟢 [Done] **G0.1a 参照条件:** MemoryのRecord参照を修正し、polymorphic参照の共通判定と複数ユーザーテストを追加。
- 🟢 [Done] **G0.1b workspace境界:** singleton workspaceとmembership roleへ移行し、`created_by`を作者情報へ限定。全読書き・Job・Export・Snapshot・Asset参照を同じmembership境界へ統一。migration前backupの復元も確認。
- 🟢 [Done] **G0.2a Record承認整合性:** 一般POST／PATCH／同期Import／Workerからworkflow状態を直接確定できないようにし、すべてdraftとして作成。承認済みRecordの新Versionをdraftへ戻し、Reviewを旧Versionへ固定。
- 🟢 [Done] **G0.2b Memory revision:** Memoryの更新、Relation Evidence追加、Verificationにrevision競合制御を追加。承認済み／却下済み内容の編集をcandidateへ戻し、Decisionに対象revisionと内容snapshotを固定。migration前backupからの復元・再migrationも確認。
- 🟢 [Done] **G0.3a 共有契約とCI:** Event入力schema／DB変換、Import解析／正規化をAPIとWorkerで共有。空DBへの全migration、共有契約テスト、実Worker統合試験を同一CI jobへ追加。
- 🟢 [Done] **G0.3b 試験分割:** 認証、Record出典・タグ・監査、品質Review、別ユーザーの版固定承認、Import／Export、Memory同期・署名取り込み、Worker取り込み、グラフ・Evidence・Verification、Asset、Dataset／Trainingを独立ケースへ分割。巨大な統合ケースを撤去した。LIFO fixtureはassert前に返却IDを登録し、途中失敗したMemory Jobの停止・子データ／object回収も検証する。[検証記録](asset-retention-and-test-isolation-progress-2026-10-11.md)。

English: G0.3b is complete. Record provenance and quality Review, Memory synchronous/signed ingestion, Worker ingestion, graph/evidence/verification and the other domains have independent fixtures and cases. The monolithic integration case was removed; Memory cleanup after an injected failure is tested.

简体中文：G0.3b已完成。Record来源与质量审核、Memory同步及签名导入、Worker导入、图谱／证据／验证等领域均有独立fixture和测试；已移除大型集成用例，并验证Memory中途失败后的清理。

- 🟢 [Done] **G0.4 ジョブ復旧:** lease／heartbeat／claim世代、世代条件付き確定、定期reaper、retry上限を導入。Redis通知が停止してもtimeout付きでDB pollingを継続し、round-robin claimでJob種別の飢餓を防止。専用Docker試験で回帰確認。
- 🟢 [Done] **G0.5a Asset保持・削除retry:** 一時upload／確定版の分離に加え、参照中Assetを保持。明示的なbinding解除後の論理削除と永続削除Jobを同一transactionで確定し、原本を既定24時間保持。一時uploadは署名URL失効＋猶予後に回収。WorkerがDB polling、retry上限、lease復旧、claim世代の排除で削除を行う。Job閲覧・管理者retry APIを追加し、ストレージ障害・旧claim・参照保護を検証。[検証記録](asset-retention-and-test-isolation-progress-2026-10-11.md)。
- 🟢 [Done] **G0.5b1 Asset照合:** Asset namespaceのDB未所有objectを報告し、ready原本の欠損・size／hash不一致とストレージ障害を区別する運用コマンドを追加。削除完了後に再出現した一時upload／削除済み原本は、保持期限・参照・bucket／key・状態を再検査して既存Jobだけを再開する。既定は読み取り専用、未知objectは自動削除しない。[操作・検証](asset-reconciliation-progress-2026-10-15.md)。
- 🟢 [Done] **G0.5b2 協調backup／restore:** API・Worker停止中にDB dumpと設定済みbucketの全現行objectをbundle化し、別Compose projectのDB／MinIOへ復元。全アプリテーブルの件数・内容hash、全object hash、版・polymorphic参照を検証する。欠損・改変・既存環境への上書きを拒否し、通常失敗・協調中断時は元サービスの復帰を試みる。[操作・検証](coordinated-backup-restore-progress-2026-10-15.md)。
- 🟢 [Done] **G0.4b 実kill試験:** 隔離DB／object storeと実Workerを使い、Importの行transaction、Exportのobject保存後の完了UPDATE、Memory Eventの一括INSERT中にSIGKILL。部分結果のrollback、自然なlease切れからの再claim、欠落・重複防止、最終参照・byte／hashを検証。CIへ追加。[検証記録](worker-crash-recovery-progress-2026-10-22.md)。
- ⭕️ [Pending] 本番provider・別物理host・実権限・実データ量でのDB＋object復元とRPO／RTO測定。

English: Referenced Assets are retained, including references to soft-deleted targets. After explicit detachment, logical deletion and durable jobs commit together; originals remain for 24 hours by default. Staging cleanup waits for signed-URL expiry plus grace. PostgreSQL polling, fenced claims, retries and lease recovery are verified. Asset inventory and integrity reconciliation now report unowned keys, missing/corrupt originals and storage errors. Opt-in apply reopens only completed deletion jobs after retention and reference checks, preserving claim generations. Offline DB/object bundles now restore into isolated volumes with table fingerprints, object hashes and reference checks. Actual Worker SIGKILL during Import, Export and Memory ingestion is verified in disposable volumes, including partial rollback, recovered claims and final object hashes. G1 Source revision is next; production/off-host restore remains pending.

简体中文：保留被引用的Asset，包括已软删除目标的引用。显式解除绑定后，逻辑删除和持久任务在同一事务提交；原本默认保留24小时。临时上传在签名URL过期并经过宽限期后清理。已验证DB轮询、claim世代、重试及lease恢复；已加入Asset清单及完整性核对，分别报告无DB归属对象、原本缺失／损坏及存储错误。显式apply只在重新检查保留期及引用后重启已完成的删除任务，并保留claim世代。已实现离线DB／对象bundle及隔离恢复，并核对表fingerprint、对象hash和引用。已在隔离volume验证Import、Export和Memory导入中的真实SIGKILL，包括部分回滚、重新claim和最终object hash。下一步为G1 Source版本；生产／其他物理host恢复仍为Pending。

次はG1のSource revisionと出典版固定。G0の開発環境検証は実kill試験を含め完了した。本番provider・別物理hostの確認は引き続きPendingであり、G1の開発とは分けて扱う。各修正に必要な回帰試験はその修正と同時に追加する。既存データの変更前にbackupと復元確認を行う。

**完了条件:** Recordを端点／証拠にした正常系、権限外・複数ユーザーの拒否、承認済み内容の変更、同時PATCH、全Import経路の承認制約を独立テストで確認。Jobのlease切れ、旧claim、Redis停止、retry上限と公平性、およびAsset確定後の旧PUT URL再利用による原本不変性は確認済み。object削除失敗からのretryとlease切れの復旧も確認済み。別Compose projectのDB＋object復元と参照・hash一致は確認済み。実WorkerのImport／Export／Memory処理途中killと再開も確認済み。本番・別物理hostの復元保証はPendingとする。

## G1 — 訂正できる知識モデル（現在の着手対象）

- 🟠 [Next] Source revision、Recordの解釈に必要な属性と出典版の固定
- 🔴 [Later] Evidenceを参照対象revisionへ固定し、独立Sourceと重複証拠を区別
- 🔴 [Later] valid time／recorded time、supersedes／retraction、文脈付き矛盾の最小表現
- 🔴 [Later] 依存関係とtransactional outbox、stale判定、再検証Job、取消の利用trace
- 🔴 [Later] 不変Snapshotの影響表示、Source／Asset／policy版を含む再現bundle

**完了条件:** v1根拠からRelationとDataset／Runを作り、v2訂正・撤回で依存先を識別できる。新しいstrict利用では古い依存先を除外し、過去Snapshotはv1利用を説明できる。過去状態が復元不能な既存データを推測で補完せず明示する。変更元→依存先の完全な再構築試験を保存する。

## G2 — 検索と利用による価値実証（G1完了後）

- 🔴 [Later] 三言語の字句検索baseline、cursor pagination、候補／確定知識の検索契約
- 🔴 [Later] chunk／EmbeddingをRecord revision・encoder版へ固定。pgvector検索＋字句検索の比較
- 🔴 [Later] bounded traversalの省略理由・上限・タイムアウト、必要な根拠を返すretrieval API
- 🔴 [Later] API schema／response／errorのOpenAPI契約と、回答context取得・学習bundle取得の2クライアント
- 🔴 [Later] 最小の検索・出典・差分・レビュー画面を日本語／English／简体中文で実装
- 🔴 [Later] 訂正・撤回・時点・権限・矛盾を含む固定評価セットと比較レポート

**完了条件:** [成功基準](success-criteria.md)のG2指標を実測する。同じコーパス・モデル・予算で、PostgreSQL + pgvectorの単純RAGと比較する。Graphitiも可能な同条件で比較し、動かしていない構成を順位付けしない。検索index再構築中でも厳格な読取から失効知識が漏れない。

## G3 — 限定本番pilot（G2の価値実証後）

- 🔴 [Later] 10⁴ → 10⁵ Record／Relationの段階負荷試験、更新中検索、Job待ち時間、storage増加量の記録
- 🔴 [Later] DB最小権限、監査対象の不足、監査保持期間、restore drill、migration切戻し、運用指標
- 🔴 [Later] XServer VPS Cloudの拡張・接続・backup能力検証。App VPS + Managed PostgreSQL + NFSと通常VPS WorkerのHTTPS境界を実装
- 🔴 [Later] object保管方式を確定。NFSをbackupやS3 APIの代替とみなさない
- 🔴 [Later] 独立した利用者2名以上による2週間のpilotと、導入・訂正・調査時間の測定
- 🔴 [Later] 配布ライセンス、外部データ利用条件、削除・撤回・保持policyの確定

**完了条件:** 固定環境のSLOと復元目標を満たし、利用者が訂正・根拠追跡を継続利用する。費用、障害時対応、制限を明文化する。利点がなければ保存API／データ管理基盤へ範囲を縮小し、独自DBとしての機能拡張を止める。

## G4 — 実証後に選ぶ拡張

- 🔴 [Later] Asset processing、media metadata抽出、derived-Asset lineage（旧Nextから移動）
- 🔴 [Later] 10,000件超Eventのstaging、streaming Import／Export、大規模非同期Snapshot／split
- 🔴 [Later] WordPress差分同期・再送、trainer callback、Run比較・checkpoint詳細
- 🔴 [Later] Data Refineryの版付きAssessment・権利／用途別eligibility。Coverage／Information Gainは単純選定より改善した場合に採用
- 🔴 [Later] 複数組織SaaS、RLS等の防御追加、partition／分散化は測定された必要性に基づく

## 研究track — DBのリリースから独立

- 🔴 [Later] [意味凝縮 SC-0〜SC-2](semantic-condensation-and-concept-discovery.md)：文章量と文脈多様性の比較、条件付き概念抽出、既存概念との照合、上限付き再探索。生成例を独立証拠に数えず、未知事例で有用性を測る。

- 🔴 [Later] Structure／Delta／Transformation、構造共有・未知関係生成、factorization／composition
- 🔴 [Later] cross-modal Factor、自己組織化Unit／Assembly、Stability／Replay、Spectral scorer
- 🔴 [Later] Fractal Canopy FC-0〜5、HLC-0〜4、ICP-0〜5、SNN-L0〜5、RISA／SARA Engine

詳細な個別項目と段階名は[旧roadmap](roadmap-archive-2026-09-05.md)および各研究文書を保持する。研究ごとに一つの仮説、単純baseline、held-out分割、計算予算、失敗条件を事前固定する。toy experimentで価値が出る前に本番schemaを追加しない。研究が失敗してもG0〜G3は成立する構成を維持する。

## 進捗更新のルール

1. Nextは現在着手するgateの未完了項目だけに付ける。後段は依存gateが完了してからNextへ移す。
2. Doneへ移す際は、変更・migration・試験コマンド・結果・残る制限をprogress文書へ記録する。
3. API数やtable数を成果指標にしない。正しい訂正、根拠の再現、利用者の工数削減を評価する。
4. 各gateで続行／範囲縮小を決定する。未達のまま研究機能追加で成果を代替しない。
