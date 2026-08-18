# 構造共有による知識創発

## 設計判断

この研究仮説は重要性が高いため、RISAおよびSARA Knowledge Serverの将来設計へ採用する。

RISAを「ノードと関係を記憶する仕組み」だけとは定義しない。目標を次のように拡張する。

```text
RISA
= 構造を記憶する
+ 構造を圧縮する
+ 構造間で共有する
+ 構造を再利用する
+ 構造から未保存の関係候補を生成する
```

ただし、現時点では研究仮説であり、構造を保存すれば知識が必ず創発するとは断定しない。

構造の具体表現、型付きDelta、Transformation Pattern、MDL評価については`structure-delta-transformation-memory.md`を参照する。

## 問題設定

明示的な知識グラフは、事実を正確かつ修正可能に保存できる。一方、個別のノードとエッジを増やすだけでは、保存済みの関係を検索するシステムに留まり、未知の関係を補間・類推できない可能性がある。

```text
単純な構造記憶
個別事例 → 個別エッジ → 保存済み関係の検索

目標とする構造共有
個別事例 → 共通パターン → 別事例への再適用 → 未知関係候補
```

LLMのパラメータ共有に相当するものを、RISAでは**複数の具体例が参照する再利用可能な構造パターン**として明示化する。

## 知識の研究上の定義

RISAにおける知識を、個別ノードや個別エッジだけではなく、次の組として扱う。

```text
K = (
  再利用可能な構造パターン,
  具体的な適用事例,
  文脈・時間・役割制約,
  支持証拠と反例,
  推論規則,
  導出履歴
)
```

例えば「支える」は、柱・脚・骨格・根などの語を共通化するだけでなく、次の役割構造として表現する。

```text
X --supports--> Y

制約:
- XはYの安定性または存続へ寄与する
- Xの除去でYの状態が悪化する可能性がある
- 物理・生物・組織などの文脈を持つ
```

## 共有する構造

構造パターンは、単なるrelation typeではなく、以下を含められるようにする。

- 変数化されたノードと役割
- 関係列または小規模subgraph
- 時間順序
- 因果方向
- 上位・下位概念との位置
- 必須条件と例外条件
- 文脈と有効期間
- 支持数、反例数、確信度
- パターンの利用回数と有用性
- 生成元エンジンとバージョン
- 検証状態

構造類似の軸は、少なくとも次を区別する。

```text
役割的類似
位相的類似
時間的類似
因果的類似
階層的類似
文脈的類似
```

Embedding類似だけで同一パターンと判断しない。明示構造、制約、証拠と併用する。

## 推奨する概念データモデル

将来の`memory`スキーマで、次の保存単位を追加候補とする。

### `memory.structural_patterns`

再利用可能な構造的不変量を保存する。

```text
pattern_uid
pattern_type
canonical_structure
variables
constraints
context
support_count
counterexample_count
confidence
generalization_score
utility_score
verification_state
proposal_source
engine_version
```

### `memory.pattern_instances`

パターンと具体的なsubgraph・観測を接続する。

```text
pattern_id
instance_type
instance_id
variable_bindings
fit_score
evidence_refs
context
verification_state
```

### `memory.pattern_similarities`

パターン間の類似軸と強度を保存する。

```text
source_pattern_id
target_pattern_id
similarity_type
similarity_score
derivation
model_version
```

### `memory.inference_proposals`

構造再利用から生成された、まだ保存済み事実ではない関係候補を保存する。

```text
proposal_uid
pattern_id
source_bindings
proposed_relation
confidence
novelty_score
derivation_trace
evidence_refs
counterexample_refs
verification_state
proposal_source
engine_version
promoted_relation_id
```

これらは実装済みテーブルではない。Memory APIの設計時にmigrationへ落とし込む。

この層の下では、具体構造を`memory.structures`、構造間差分を`memory.structure_deltas`として保持する。複数Deltaから得られる変換知識は`memory.transformation_patterns`としてLayer 3を形成する。

## 処理パイプライン

```text
1. 観測・Record・Eventから局所構造を形成
2. 既存パターンとの適合度を計算
3. 適合すればpattern instanceとして接続
4. 適合しなければ新規パターン候補または分裂候補を作成
5. 類似パターン、上位構造、時間・因果構造をtop-k探索
6. 未充足の変数または関係を推定
7. inference proposalとして保存
8. 既存事実、反例、文脈制約と照合
9. 人間または承認済みルールで検証
10. 承認後のみrelationへ昇格
```

## 波及と安全性

LLMのように一つの経験が全体へ弱く影響する性質を、無制限な全探索で模倣しない。

構造変更の波及には次の制約を設ける。

- 類似度上位top-kだけを対象にする
- 最低類似度と最低証拠数を要求する
- 距離に応じて影響量を減衰させる
- 文脈・時間・因果方向が不一致なら停止する
- 1回の更新で変更可能な候補数を制限する
- 推論候補から推論候補への連鎖深度を制限する
- 確定relationを自動上書きしない
- 反例と例外を失わない
- 導出経路を再現可能にする
- 回帰評価に失敗した更新を取り消せるようにする

## Knowledge ServerとRISAの責務

```text
RISA / SARA Engine
= パターン抽出、構造圧縮、類似計算、候補生成、推論

SARA Knowledge Server
= パターン、事例、候補、証拠、導出履歴、検証状態の正本
```

Knowledge Server自体へ特定の推論アルゴリズムを固定しない。複数のRISAバージョンやルールエンジンを比較できるよう、生成元とバージョンを必須にする。

## 「知識が創発した」と判断する基準

単に保存済みrelationを取得できることは、構造的知識の創発とはみなさない。

最低条件を次のように定義する。

```text
明示的に保存していない関係を、
再利用可能な構造パターンと新しい入力の対応から候補生成し、
導出根拠を提示できること。
```

評価指標:

- held-out relationの候補生成精度
- 類推・別領域転移のprecision@k
- 推論confidenceの較正誤差
- 反例・文脈違反率
- 人間承認率と却下率
- パターン再利用回数
- 通常のgraph traversalとの差分
- Embedding検索単体との差分
- LLM単体、通常RAGとの比較
- 構造更新1件あたりの計算コスト
- 推論導出の再現率

## 失敗条件

以下の場合、構造共有機構は有効とはみなさない。

- 個別relationを別形式で保存しただけである
- 未保存関係を生成できない
- 類似という理由だけで誤った関係を大量生成する
- 推論候補と検証済み事実を区別できない
- 例外・反例・文脈を失う
- 通常の検索やRAGより精度・コスト面で改善しない
- 導出経路を説明または再現できない

## 実装段階

- [Next] 現行のSource・Record基盤を完成させ、出典追跡を先に保証する
- [Later] toy graphでstructural patternとinstanceの最小表現を検証する
- [Later] held-out relationを用いた構造類推ベンチマークを作る
- [Later] pattern・instance・inference proposalのMemory Schemaを実装する
- [Later] top-k局所波及とフィードバック候補を接続する
- [Later] LLM、RAG、graph traversal、RISA構造共有を比較評価する

## 結論

RISAの価値は、構造を保存できることだけでは決まらない。

**複数の経験から再利用可能な構造を抽出し、その構造を別の事例へ安全に適用して、未保存の関係候補を生成できるか**を主要な研究目標とする。
