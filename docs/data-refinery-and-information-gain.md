# Data Refinery・情報利得・系譜設計

この文書は、SARA Knowledge Serverを単なるデータ保管庫ではなく、学習可能な知識資産を継続的に精製する`Data Refinery / Knowledge Foundry`へ発展させるための設計方針である。現時点では研究・将来実装仕様であり、既存APIの契約ではない。

## 採用する判断

モデル性能をデータ件数だけで改善しようとしない。重複、矛盾、出典不明、知識領域の偏り、教材順序の不備が性能上限を作るという仮説を、測定可能な形で検証する。

```text
Source
  ↓
Canonical Knowledge
  ↓
Training Material
  ↓
Dataset Build
  ↓
Training / Evaluation Impact
```

- **Source:** 原文、Asset、取得時刻、権利、checksumを不変に保存する。
- **Canonical Knowledge:** 主張、実体、関係、文脈、時間的有効性、証拠、反例を表す。
- **Training Material:** Instruction、Chat、DPO、イベント列などの用途別派生物を版管理する。
- **Dataset Build:** Definitionと不変Snapshotにより、選定方針と収録物を再現する。
- **Impact:** Training Runと評価結果から、予測した価値と実測効果を照合する。

Source、Knowledge、Training Material、Datasetを同じIDや同じ行へ押し込まない。既存の`source_id`、`record_version_id`、`dataset_snapshot_id`、`training_run_id`を活用し、将来は`knowledge_assertion_id`と`training_material_version_id`を加える。

## 評価値は固定属性にしない

品質、新規性、カバレッジ、情報利得、学習可否は、対象そのものの永続的な真理ではない。評価器、知識空間、時点、対象モデル、用途によって変わるため、Recordへ最新値だけを上書きしない。

将来の評価記録は追記型とし、最低限次を持つ。

```text
subject_type / subject_id / subject_version
evaluator_type / evaluator_id / evaluator_version
corpus_or_snapshot_id
taxonomy_version
score_policy_version
metric_components
confidence
evidence
evaluated_at
```

保存する主要な評価軸は次の通りである。

- Coverage: 既存知識空間の不足をどれだけ埋めるか
- Novelty: 既存資産に対して新しい情報を含むか
- Provenance / Reliability: 出典と変換過程をどこまで信頼できるか
- Contradiction: 既存主張とどの文脈・期間で競合するか
- Lineage: 原文から現在の成果物まで再現できるか
- Information Gain: 追加による予測・検索・学習上の改善見込み
- Difficulty: 推論深度、時間跨度、曖昧性、モダリティ横断の難しさ
- Redundancy: 同じ役割のデータが既に十分存在するか

`training_value`の合成値だけを正本にしない。各成分と計算方針を残す。初期の候補式は次のように置けるが、選別器として固定せず、ランダム選定・品質のみの選定との比較実験を必須にする。

```text
estimated_information_gain
≈ novelty × reliability × coverage_gain × (1 - redundancy)
```

0への潰れ、相関した尺度の二重評価、人気領域への過集中を避ける。予測値はTraining Run後の実測改善と較正する。

## Coverageと不足領域

件数ではなく知識空間の被覆を測る。Coverage cellは、例えば次の次元の組合せとして扱う。

```text
concept / relation / context / difficulty / modality / language / valid_time
```

Coverageは必ずtaxonomyまたはontologyの版とDataset Snapshotに対して計算する。不足cellを`Research Queue`へ送り、既存資料の探索、生成候補、レビュー候補を優先する。生成量ではなく、追加前の推定`coverage_gain`と追加後の実測効果を評価する。

## 矛盾は削除せず束ねる

競合する主張を一つの真偽値へ潰さない。

```text
Claim Cluster
├── Claim A ─ Evidence / Source / Context / Valid time
├── Claim B ─ Evidence / Source / Context / Valid time
└── Assessment ─ Consensus / Conflict / Preferred-for-context
```

`preferred`は普遍的な真実ではなく、評価方針、用途、文脈、時点に対する判断として版管理する。少数説、例外、古い時点で有効だった主張も保持する。

## 変換系譜DAG

原文から学習利用までを、有向非巡回グラフとして追跡する。

```text
Source / Asset
→ Record Version
→ Knowledge Assertion
→ Training Material Version
→ Dataset Snapshot Entry
→ Training Run
→ Evaluation Result
```

Derivation edgeには、親子ID、変換種別、processor/model/rule/promptの版、パラメータ、コードrevision、作成者、日時を保持する。循環を拒否し、各成果物から原文と権利情報へ戻れることを不変条件にする。

## 学習可否とCurriculum

`training_eligible`をレコードの永続booleanにしない。対象モデル、Dataset Definition、license、holdout方針、時点を含むversioned policy decisionとして、理由付きで記録する。

難易度1〜7の単一ラベルはUI上の便宜として利用できるが、内部では推論深度、必要な前提、時間跨度、曖昧性、cross-modal性を分離する。Dataset Build時にcurriculum順序を生成し、順序なしbaselineと比較する。

## 管理画面と配置境界

AI-data-manager／管理画面には「このデータを加えると何を学べるか」を示すImpact Cardを置く。

```text
quality / reliability / novelty / coverage gain
redundancy / contradiction / difficulty
estimated training value / recommendation / reasons
```

数値だけでなく、評価条件、根拠、未確定事項を表示する。重い抽出、重複判定、coverage計算、複数モデル評価はWorkerへ送る。本番ではXServer VPS Cloud側のHTTPS APIまたはジョブキューを通し、通常VPS WorkerからManaged PostgreSQLへ直接接続しない。

## 段階実装

- [Later] DR-0: 評価軸、taxonomy version、score policy、比較baselineを定義
- [Later] DR-1: 追記型Assessmentと変換系譜DAG
- [Later] DR-2: Coverage cell、Gap検出、Research Queue、推定Information Gain
- [Later] DR-3: Claim Cluster、文脈・時点付き矛盾管理、合意度評価
- [Later] DR-4: Training Material版管理、policy依存eligibility、curriculum build
- [Later] DR-5: Impact Cardと、予測価値対Training Run実測効果の較正

## 成功・失敗判定

成功は高スコアのデータが増えることではない。Dataset Buildの再現性、lineage完全率、不足領域の縮小、重複削減、人間レビュー時間の削減、同じ計算予算での評価改善によって判定する。スコア最適化だけが進み、held-out評価が改善しない場合は失敗とみなす。

## English summary

The server should evolve into a Data Refinery: immutable sources become canonical claims, versioned training materials, reproducible dataset snapshots, and measured training impact. Quality, novelty, coverage gain, contradiction, difficulty, and eligibility are contextual assessments—not permanent columns of truth. Store their components, evaluator and policy versions, preserve a derivation DAG to the source, and calibrate predicted information gain against actual training results.

## 简体中文摘要

本系统应发展为数据精炼与知识铸造平台：从不可变原始来源生成规范化主张、版本化训练材料、可复现数据集快照，并追踪真实训练效果。质量、新颖性、覆盖增益、矛盾、难度和训练资格都属于依赖语境的评估，不应作为永久真值直接覆盖。系统必须保存评估组件、评估器与策略版本、完整转换DAG，并用训练后的实际结果校准预测信息增益。
