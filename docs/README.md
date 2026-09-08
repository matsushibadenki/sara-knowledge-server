# SARA Knowledge Server ドキュメント

このディレクトリには、プロジェクトの重要な知識を保存します。

## 保存する内容

- 設計・アーキテクチャの決定事項
- API、データベース、外部連携の仕様
- 調査結果と技術選定の理由
- 実装方針、運用手順、移行手順
- 重要な変更履歴と未解決事項

## 運用ルール

- 重要な決定を行ったら、関連するドキュメントを同時に更新する
- 仕様変更時は、変更理由と影響範囲を記録する
- 一時的なメモと確定仕様を混在させない
- 外部サービスやリポジトリを参照した場合は、参照先と確認日を記録する
- 実装とドキュメントに差異がある場合は、未反映であることを明記する

## 現行方針と履歴

実装順序は `roadmap.md`、2026-09-05以降の設計判断は `database-direction-review-2026-09-05.md`、合否判定は `success-criteria.md` を参照する。旧設計書・研究資料と衝突する優先順位はこの3文書を優先する。APIの現状は実装と個別仕様を確認し、未実装の新契約と区別する。日付付きprogress文書は当時の検証記録であり、現在の稼働保証ではない。

## 現在の主要ドキュメント

- `access-boundaries.md`: singleton workspace membership、作者情報、role／scopeのアクセス契約
- `access-boundary-progress-2026-09-08.md`: Record参照修正とworkspace移行、backup／復元、複数ユーザーテストの実装記録
- `approval-integrity-progress-2026-09-08.md`: Record承認経路、更新時draft化、同期／非同期Import制約の実装記録
- `memory-revision-progress-2026-09-08.md`: Memory revision、Verification snapshot、同時更新、backup復元の実装記録
- `shared-contracts-ci-progress-2026-09-08.md`: API／Worker共有契約、空DB migration、実Worker CIの実装記録
- `semantic-condensation-and-concept-discovery.md`: 多様な表現からの概念抽出、由来別の証拠管理、条件・反例・再探索のSC-0〜SC-2実験

- `database-direction-review-2026-09-05.md`: 新しい知識DBとしての成立条件、実装上の不足、revision／訂正／配置／移行方針
- `success-criteria.md`: 製品gate、三言語比較、正しさ・性能・運用の未測定目標
- `roadmap-archive-2026-09-05.md`: 改訂前の計画と研究項目の履歴（実装順序ではない）

- `assets.md`: Binary Asset lifecycle、presigned URL、hash検証、provenance binding
- `data-refinery-and-information-gain.md`: Data Refinery、知識空間Coverage、情報利得、矛盾管理、変換系譜DAG
- `asset-api-progress-2026-09-02.md`: Asset API節目の実装・検証記録
- `snn-learning-open-problems.md`: SNN学習の未解決点、多時間スケールcredit memory、必須baseline
- `industrial-neural-computational-primitives.md`: 脳の計算原理を交換可能な工業部品へ置換する研究設計
- `hierarchical-local-credit-assignment.md`: global gradientを必須としない階層的local credit研究方針
- `fractal-canopy-routing-research.md`: 自己相似的階層routing、動的深度、branch成長・剪定の段階実験
- `async-event-ingestion.md`: 501〜10,000 Eventの非同期・原子的取り込み
- `async-event-ingestion-progress-2026-09-01.md`: 非同期Event節目の実装・検証記録
- `signed-worker-ingestion.md`: 外部WorkerのHMAC署名、nonce、冪等再送、配置境界
- `signed-worker-ingestion-progress-2026-08-31.md`: 署名取り込み節目の実装・検証記録
- `bulk-event-and-bounded-traversal.md`: 原子的Bulk Event取り込み、制限付き探索、外部Worker境界
- `bulk-event-traversal-progress-2026-08-31.md`: 同節目の実装・検証記録
- `sara-knowledge-server設計書.txt`: 全体設計仕様書
- `roadmap.md`: 実装進捗と次工程
- `database.md`: DBスキーマとmigration運用
- `authentication.md`: 認証方式と開発用seed
- `records.md`: Record CRUDとバージョン管理
- `sources.md`: Source CRUD、出典追跡、Recordとの関連付け
- `audit-logs.md`: Source・Record変更の監査、閲覧制御、データ最小化
- `quality-and-review.md`: Tag・Annotation・Evaluation・Version固定レビューの仕様
- `quality-review-progress-2026-08-31.md`: 品質管理・レビュー節目の実装・検証記録
- `import-export.md`: JSON／JSONL／CSV取り込み・出力、冪等性、上限
- `import-export-progress-2026-08-31.md`: Import／Export節目の実装・検証記録
- `async-worker-progress-2026-08-31.md`: MinIO・Redis・Worker非同期処理の実装記録
- `dataset-snapshots.md`: 再利用可能なDataset Definition、不変Snapshot、manifest仕様
- `dataset-snapshot-progress-2026-08-31.md`: Dataset Snapshot節目の実装・検証記録
- `training-runs.md`: Model Registry、再現可能なTraining Run、追記型Metric仕様
- `training-run-progress-2026-08-31.md`: Training Run節目の実装・検証記録
- `memory-core.md`: Event・Experience・Entity・Concept・Relationの中核仕様
- `memory-core-progress-2026-08-31.md`: Memory Core節目の実装・検証記録
- `evidence-alias-verification.md`: Relation Evidence、Alias正規化、候補検証仕様
- `evidence-alias-verification-progress-2026-08-31.md`: Evidence・Alias・Verification節目の検証記録
- `late-labeling-and-emergent-concepts.md`: 遅延ラベリングと創発的概念形成の研究仮説
- `feedback-driven-structural-updates.md`: フィードバック駆動の構造更新方針
- `structural-knowledge-emergence.md`: 構造共有・再利用・未知関係候補生成の研究設計
- `structural-factorization-and-compositional-reasoning.md`: 問題の構造分解、因子発見、制約付き合成推論の研究設計
- `cross-modal-structural-abstraction.md`: 文章・映像・音／音楽・触覚間の共有構造候補と固有残差の研究設計
- `structure-delta-transformation-memory.md`: Structure・型付き差分・変換知識・MDLの記憶設計
- `self-organizing-shared-representations.md`: 局所表現の再利用から概念候補が形成される自己組織化設計
- `dynamical-structural-validation.md`: 予測誤差・競合・恒常性・Replayによる力学的検証設計
- `spectral-neuron-assessment.md`: Spectral Neuronの評価と制約付きscorerへの限定採用方針
