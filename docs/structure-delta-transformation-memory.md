# Structure・Delta・Transformation記憶モデル

## 設計判断

この考え方はRISAの構造表現、差分学習、概念形成を接続する中心設計として採用する。

```text
Memory = Structure + Delta + Transformation

Concept
= 多数の経験間で保存される構造的不変量

Learning
= 新しい経験を、より少ない共通構造・差分・例外で
  説明できるように記憶体系を再編成すること
```

構造を完成済みグラフとして毎回複製せず、共通構造と差分を共有する。ただし、差分だけを正本にして長いチェーンを復元する方式にはしない。不変スナップショット、出典、型付き差分、checkpointを併存させる。

共通構造は、明示的なgraph matchingだけで抽出するとは限らない。経験が同じ局所Unitを参照した結果として共有部分が形成される自己組織化経路も持つ。この場合、型付きDeltaは学習の唯一の内部表現ではなく、版変更、二時点比較、説明、取消、監査のために生成する派生表現となる。詳細は`self-organizing-shared-representations.md`を参照する。

## 三層の記憶

```text
Layer 3: 変換知識
────────────────────────
飛行能力喪失型
ΔA similar ΔB
ΔA often-followed-by ΔC
ΔX + ΔY composes-to ΔZ

Layer 2: 抽象構造
────────────────────────
THROW(Agent, Object)
SUPPORT(Supporter, Supported)
CONTAINER(Container, Content)

Layer 1: 具体的経験
────────────────────────
太郎がボールを投げた
花子が石を投げた
ペンギンは鳥だが飛ばず、水中を泳ぐ
```

Layer 1からLayer 2へは、具体値の差分を除いた不変構造を抽出する。複数のDeltaから共通編集列を抽出し、Layer 3のTransformation Patternを形成する。

## Structureの表現

基本構造を次の組として扱う。

```text
S = (V, E, R, T, C, Q, O)

V: Entity / Event / Concept / Valueなどのノード
E: 二項関係または多項関係
R: Agent / Object / Instrumentなどの役割
T: 時刻、順序、期間、位相
C: 文脈、条件、有効範囲
Q: confidence、確率、強度
O: provenance、観測、出典、生成元
```

イベントは単純な二項エッジへ潰さず、役割を持つノードまたはhyperedgeとして表現できるようにする。

```text
THROW event
├── Agent  → 太郎
├── Object → ボール
└── Time   → t1
```

言語ラベルと構造識別を分離する。「太郎」「花子」の表層差分があっても、`THROW(Agent, Object)`という役割構造を共有できるようにする。

## canonical form

構造比較の前にcanonicalizationを行う。

- node typeとrole typeを正規化する
- 構造内のlocal IDを安定化する
- 順序を意味的に必要な場合だけ保持する
- JSON配列・relationを決定的にsortする
- 言語ラベルとcanonical identifierを分離する
- 時間・単位・数値表現を正規化する
- 文脈とprovenanceを構造本体から失わない
- canonical formからcontent hashを生成する

同じ意味構造が異なる入力順序で登録されても、同じhash候補を得られることを目標とする。ただし同一hashだけで自動統合せず、出典と具体的経験は別に保持する。

## Deltaの表現

Deltaを単なるJSON差分や追加・削除だけにしない。意味構造用の型付き編集演算子列として保存する。

```text
ADD_NODE
REMOVE_NODE
ADD_RELATION
REMOVE_RELATION
CHANGE_ROLE
CHANGE_VALUE
CHANGE_CONTEXT
GENERALIZE
SPECIALIZE
REORDER_TIME
SHIFT_TIME
MERGE
SPLIT
ADD_EXCEPTION
REMOVE_EXCEPTION
```

各operationは次を持つ。

```text
operator
target_selector
before
after
preconditions
postconditions
confidence
evidence_refs
context
```

これにより、同じ`REMOVE_RELATION`でも「誤りの訂正」「文脈限定」「一般構造からの例外」を区別できる。

## Structureの版とDelta DAG

構造と差分は不変データとして保存する。

```text
Structure A@1
├── Delta 1 → Structure A@2
├── Delta 2 → Structure B@1
└── Delta 3 → Structure C@1
```

履歴は一本の継承木に限定せずDAGとして扱う。複数の基底候補、merge、split、別文脈への派生を表現できるようにする。

安全要件:

- 元の観測・Record・Eventを削除しない
- Deltaのfrom/to structure hashを固定する
- operation適用前にpreconditionを検証する
- 適用後のstructure hashを再計算する
- 長いDelta chainにはmaterialized checkpointを作る
- 復元結果を定期的にsnapshotと比較する
- 例外を親構造の上書きとして消さない
- 誤った継承を取消可能にする

## Transformation Pattern

複数のDeltaに共通する編集列を、新しい変換知識として抽出する。

```text
Delta 1: 鳥 → ペンギン
Delta 2: 鳥 → ダチョウ
Delta 3: 鳥 → エミュー

共通候補:
- REMOVE capability: flight
- STRENGTHEN role: terrestrial locomotion
- SPECIALIZE habitat / body constraints
```

Transformation Patternは、単なるDeltaクラスタではなく次を持つ。

- 変数化された編集演算子列
- 適用可能な基底構造の制約
- 変換前後で保持される不変条件
- 必須文脈と禁止文脈
- 支持事例と反例
- 適用成功率
- 変換コスト
- verification state

変換同士にも`similar`、`causes`、`often_followed_by`、`composes_with`などの関係を作れるようにする。

## 推奨する将来データモデル

### `memory.structures`

具体構造またはmaterialized snapshotを不変保存する。

```text
structure_uid
structure_kind
schema_version
canonical_form
content_hash
context
confidence
verification_state
source_refs
proposal_source
engine_version
```

### `memory.structure_deltas`

構造間の型付き編集列を保存する。

```text
delta_uid
from_structure_id
to_structure_id
operations
edit_cost
description_length
preconditions
invariants
context
confidence
verification_state
evidence_refs
engine_version
```

### `memory.transformation_patterns`

複数Deltaから抽出した変換の不変構造を保存する。

```text
transformation_uid
transformation_type
canonical_operations
variables
applicability_constraints
preserved_invariants
support_count
counterexample_count
confidence
utility_score
verification_state
engine_version
```

### `memory.transformation_instances`

Transformation Patternと具体Deltaを接続する。

```text
transformation_id
delta_id
variable_bindings
fit_score
verification_state
```

### `memory.transformation_relations`

変換同士の類似、因果、順序、合成可能性を保存する。

```text
source_transformation_id
target_transformation_id
relation_type
strength
confidence
evidence_refs
```

前回設計した`structural_patterns`はLayer 2、今回の`transformation_patterns`はLayer 3を担当する。

## 新しい入力の統合アルゴリズム

以下は明示的なStructure比較経路である。これとは別に、局所Unitの再利用とresidual割当による自己組織化経路を比較実装する。

```text
1. 原文・観測・出典を失わず保存
2. Entity / Event / Role / Time / Contextへ構造化
3. canonical formを生成
4. 型・文脈・Embedding・indexから基底構造候補を限定
5. 候補ごとに重み付きgraph edit distanceを計算
6. Structure単独保存と「基底＋Delta」の記述コストを比較
7. 最小コスト候補を採用せず、上位候補と根拠をproposal保存
8. 人間または承認済みルールで基底・Deltaを検証
9. 類似Deltaを検索しTransformation Pattern候補を更新
10. checkpointと監査履歴を保存
```

総当たりgraph matchingは行わない。型、役割、文脈、時間、近傍hash、Embeddingなどで候補を絞ってから差分を計算する。

## MDL的な目的関数

RISAの表現評価にMinimum Description Lengthの考え方を採用候補とする。

```text
min [
  L(Shared Structures)
  + L(Instance Bindings)
  + L(Deltas)
  + λ L(Exceptions)
  + μ L(Reconstruction Errors)
]
```

単に圧縮率を最大化しない。例外や少数事例を消して圧縮することを防ぐため、再構成誤差、反例保持、出典追跡、推論性能を同時に評価する。

MDLは即時の確定アルゴリズムではなく、複数の構造化・差分化候補を比較する評価軸として導入する。

## Knowledge ServerとRISAの責務

```text
RISA / SARA Engine
= canonicalization候補、graph matching、Delta生成、
  Transformation抽出、MDL評価、再編成提案

SARA Knowledge Server
= Structure、Delta、Transformation、出典、
  検証状態、版、checkpoint、監査履歴の正本
```

Knowledge Serverは、RISAが提案した最小差分を無検証で採用しない。アルゴリズムとバージョンを記録し、別アルゴリズムで再評価可能にする。

StructureとTransformationの候補は、明示的なgraph matchingに加えて、再生時の予測誤差、競合、Replay耐性から動的支持を評価できる。ただし動的支持だけで`verified`へ昇格させない。詳細は`dynamical-structural-validation.md`を参照する。

## 評価指標

- 元構造の再構成成功率
- Delta適用の決定性
- 平均Delta chain長
- checkpointからの復元時間
- Structure＋Deltaによる圧縮率
- 例外・反例保持率
- 基底構造選択精度
- Transformation Patternの再利用率
- 変換適用によるheld-out予測精度
- graph matchingと統合に必要な計算量
- 導出・変更履歴の再現率

## 失敗条件

- 差分を辿らないと元の観測や根拠へ到達できない
- chain破損で多数の構造を復元できなくなる
- 圧縮のために例外や少数事例を消す
- 表層語の一致を構造的不変量と誤認する
- 異なる文脈のDeltaを同一変換として統合する
- graph matchingコストが再利用効果を上回る
- Transformationが未知関係や変化予測へ寄与しない

## 実装段階

- [Next] Source APIで全Structure・Delta候補の出典を追跡可能にする
- [Later] JSON SchemaでStructureとDelta operationの最小型を定義する
- [Later] THROWなどのtoy domainでcanonicalizationとdiffを検証する
- [Later] snapshot＋Deltaの決定的再構成テストを作る
- [Later] 類似DeltaからTransformation Patternを抽出する
- [Later] MDL、検索速度、類推精度の多目的比較を行う
- [Later] Memory SchemaとRISA Engineを接続する

## 結論

RISAでは、物や関係だけでなく**変化そのものを第一級の知識**として保存する。

概念は多数の経験から差分を取り除いて残る構造的不変量、変換概念は多数のDeltaから個別差分を取り除いて残る編集的不変量として扱う。
