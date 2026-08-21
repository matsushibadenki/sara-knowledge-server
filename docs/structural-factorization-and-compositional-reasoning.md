# 構造因数分解と構造合成推論

## 採用する研究仮説

RISAの研究テーマとして、未知の問題を再利用可能な構造因子へ分解し、因子を制約付きで再合成して未保存の解答候補を導く能力を追加する。

```text
具体的な問題
→ 抽象的なStructure候補
→ 再利用可能な因子とbindingへ分解
→ 関連因子・Transformationを局所検索
→ 制約付きで再合成
→ 具体的な解答候補へinstantiate
→ 予測誤差・反例・外部証拠で検証
```

> **English:** Structural factorization decomposes a problem into reusable relational and transformational factors; compositional reasoning recombines them under explicit constraints.
>
> **简体中文：** 结构因式分解把问题拆成可复用的关系与变换因子，结构组合推理则在明确约束下重新组合这些因子。

これは確立済みのRISAアルゴリズムではなく、検証対象の研究仮説である。「構造素因数」や`Structural Tokenization`も、この文書では既存の確立した専門用語ではなく、操作的な研究用語として使う。

## 採用しない前提

次は現段階で事実として採用しない。

- 構造断片を何億件保存すれば、それだけで未知問題を解ける
- 世界に一意で絶対的な最小構造が存在する
- 最小の分解が常に最良の推論を与える
- 頻出する因子が意味のある知識である
- 構造経路が見つかれば、その結論は真である
- SNNの共鳴だけで大規模探索を十分に解ける

記憶量は候補空間を増やすが、誤った分解、組合せ爆発、文脈違反、誤った因子の再利用を解決しない。研究の中心は保存件数ではなく、分解・候補選択・合成・検証の質と費用に置く。

## 用語の操作的定義

### Structural Factor

Structural Factorは、ノード単体ではなく、変数、関係、役割、時間、状態変化、適用制約の一部を保った再利用可能な構造単位である。

```text
Factor = (
  variables,
  relations,
  roles,
  temporal constraints,
  preconditions,
  postconditions,
  invariants,
  context
)
```

例:

```text
SUPPORTED(X, Y)
REMOVE_SUPPORT(Y, X)
UNCONSTRAINED_MOTION(X, direction)
```

単語やEntityへ細分化して関係を失ったものは、Structural Factorとはみなさない。

### Structural Primitive Candidate

それ以上の分解が不可能な絶対的「素数」とは定義しない。あるタスク集合、表現方式、計算予算において、次を満たすFactorをPrimitive候補とする。

- 異なる複数の経験・領域で再利用される
- 分解前のStructureを許容誤差内で再構成できる
- さらに分解するとheld-out予測または転移性能が低下する
- 因子導入後の記述長と探索費用を含む総費用が改善する
- 出典、反例、文脈、具体的bindingへ戻れる

Primitiveの境界はタスク、modality、時間粒度、engine versionによって変わり得る。同じStructureに複数の妥当な分解が存在することを許可する。

### Structural Factorization

StructureをFactor、binding、合成順序、制約からなるDAGまたはhypergraphへ分解する操作とする。

```text
S ≈ Compose(F1, F2, ..., Fn; bindings, constraints)
```

候補を一件へ早期確定せず、上位候補とscore内訳を保持する。

### Compositional Reasoning

保存済みの完成回答を取得することではなく、FactorとTransformationを新しいbinding・順序で合成し、未保存の状態遷移またはrelationを候補生成することとする。

```text
current state
  --T1(preconditions)--> S1
  --T2(preconditions)--> S2
  --T3(preconditions)--> goal candidate
```

各ステップで型、時間、文脈、不変条件を検査し、導出経路を再現可能にする。

## 既存設計との関係

```text
具体的経験・Record・Event
  → Structure snapshot
  → Factorization候補
  → Structural Factor / latent Unit
  → Composite Structure / Transformation
  → 推論候補とReasoning Trace
```

- `Structure`は監査可能な問題・経験・状態の明示表現
- `Delta`はStructure間の型付き編集
- `Transformation`は再利用可能な変換知識
- `representation Unit`は自己組織化する学習・活性層の内部資源
- `Structural Factor`は分解・合成時に再利用する機能単位

UnitとFactorは同一とは限らない。latent Unitの組合せが一つのFactorへ投影される場合も、一つのUnitが複数Factor候補に関与する場合もある。監査層では元のStructure、binding、出典へ戻れることを要求する。

Factorを複数modalityで共有する条件、native valueとresidualの境界、cross-modal transfer評価は`cross-modal-structural-abstraction.md`に定める。

## 推論パイプライン候補

```text
1. 問題をStructure候補へ変換
2. 型、役割、時間、文脈を保持して複数の分解候補を生成
3. MDL、再構成誤差、予測利得、探索費用で候補をscore
4. content address、symbolic index、Embedding、活性状態からtop-k Factorを取得
5. preconditionとbinding可能性で候補を削減
6. beam searchまたは制約探索でTransformationを合成
7. goalとの距離、矛盾、反例、計算予算で枝刈り
8. 解答候補を具体化し、導出経路を保存
9. sandbox Replayまたは外部環境で結果を検証
10. 承認前はinference proposalとして保持
```

全Factorとの総当たり探索は行わない。SNNによる疎な活性化や共鳴は候補取得器の一方式として比較するが、content-addressed retrieval、symbolic index、ANN、beam searchなどの単純baselineより優れることを実測する。

## 多目的なFactor評価

圧縮率だけでPrimitive候補を決めない。概念的には次を比較する。

```text
minimize:
  reconstruction_error
  + description_length
  + search_cost
  + constraint_violations
  + exception_loss

maximize:
  held_out_prediction
  + cross_domain_transfer
  + composition_success
  + provenance_recovery
```

一つの合成scoreへ早期に固定せず、各指標と重み、engine versionを記録する。

## 「構造合成で未知問題を解けた」と判断する条件

最低条件:

```text
訓練・登録時に存在しないFactorの組合せを必要とするheld-out問題で、
保存済み回答の近傍検索だけでは得られない候補を生成し、
有効な導出経路と適用制約を再現できること。
```

評価指標:

- held-out compositionの解決率
- 分解候補のtop-k recall
- 正しい因子を含む率と不要因子率
- 合成経路のvalidityと最小性
- 文脈・型・時間制約違反率
- cross-domain analogical transfer
- 原Structureの再構成誤差
- 因子・Transformationの再利用率
- 探索ノード数、応答時間、メモリ使用量
- 導出経路と出典の再現率
- 反例追加後の候補取消・再score成功率

比較baseline:

- 保存済み回答の検索
- 通常のgraph traversal
- Embedding / RAG
- 人間定義Primitiveだけの制約探索
- 学習されたFactorによる制約探索
- LLM単体とLLM + tool search
- 将来のSNN選択的活性化

## 主要な失敗条件

- 実際には問題文や回答を記憶しているだけである
- 同じFactor名でも文脈ごとに意味が変わり、誤合成する
- 分解候補が不安定でengine更新ごとに追跡不能になる
- 因子が細かすぎて探索が組合せ爆発する
- 因子が粗すぎて未知の組合せへ転移できない
- 圧縮のために例外、少数事例、出典を失う
- 経路は構文的に接続できるが、世界では成立しない
- 通常の検索、RAG、graph traversalより精度または費用が悪い
- 生成した推論候補を検証済み知識として保存する

## 将来の保存モデル候補

toy experimentの前にmigrationを固定しない。有効性が確認された場合に、次をKnowledge Serverの候補とする。

```text
memory.structural_factors
  factor_uid, canonical_form, variables, constraints,
  level, status, engine_version, source_refs

memory.structure_factorizations
  factorization_uid, structure_id, reconstruction_score,
  description_length, predictive_score, search_cost,
  engine_version, verification_state

memory.factorization_members
  factorization_id, factor_id, composition_role,
  bindings, order_or_position, local_constraints

memory.composition_proposals
  proposal_uid, input_structure_id, goal_structure,
  composed_factors, result_structure, confidence,
  verification_state

memory.reasoning_traces
  proposal_id, step_number, factor_or_transformation_id,
  state_before, state_after, bindings, checks, evidence_refs
```

Factorや分解候補はengine versionごとに再評価できるようにし、元Structureを置き換えない。

## 実装順序の依存関係

現在の直近実装であるSource・Record監査ログを置き換えない。この研究実装は、少なくともEvent／Structureの最小表現、出典binding、推論候補と確定知識の分離が整った後に開始する。

```text
監査・provenance基盤
→ Event / Structure最小表現
→ held-out composition benchmark
→ 人間定義Primitive baseline
→ Factor発見・top-k分解
→ 制約付き合成探索
→ baseline比較
→ 段階的scale試験
→ Memory Schema確定
```

10³ Factor候補で検索やRAGを超えない場合、10⁵以上へ拡大しない。規模の拡大は、精度、探索費用、導出再現率の通過条件を満たした場合だけ行う。

## 段階的な研究・実装予定

- [Done] Structural FactorizationとCompositional Reasoningを研究テーマとして採用
- [Later] 小規模な状態遷移toy domainとheld-out composition benchmarkを作る
- [Later] 人間定義Primitiveによるfactorization・再構成baselineを実装する
- [Later] MDLのみ、予測利得のみ、多目的評価によるFactor選択を比較する
- [Later] 複数分解候補を保持するtop-k factorizationを実装する
- [Later] 型・文脈・時間制約付きbeam searchでFactor／Transformationを合成する
- [Later] 検索、RAG、graph traversal、LLM、RISA合成推論を比較する
- [Later] 別領域へのcompositional transferと反例追加後の取消を評価する
- [Later] 10³→10⁵→10⁷ Factor候補の段階的scale試験を行う
- [Later] baseline確認後にSNNによる選択的活性化を比較する
- [Later] 有効性確認後にFactorization・Composition・Reasoning TraceのMemory Schemaを確定する

## 結論

RISAの知識を完成済み構造の集合だけでなく、**再利用可能な構造因子、組合せ規則、適用制約、検証可能な導出経路**として研究する。

成功条件は構造数ではない。未経験の組合せを必要とする問題を、妥当な費用で分解・再合成し、保存済み回答の検索を超える結果を再現可能に示せることである。
