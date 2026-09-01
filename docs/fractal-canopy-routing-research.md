# Fractal Canopy Routing — research hypothesis

## 日本語

## 結論

「フラクタル形状のLLM」をそのまま作るのではなく、**自己相似的な階層routingによって、入力ごとに計算深度・専門枝・cross-linkを選ぶ小規模実験**として採用する価値がある。

既存研究が直接支持する範囲は限定する。

- [FractalNet](https://arxiv.org/abs/1605.07648)は、自己相似的macro-architectureに浅い経路と深い経路を共存させ、drop-pathを使ってsubpathの共適応を抑えられることを画像分類で示した。浅いsubnetworkで早く回答し、深いsubnetworkで精度を上げるanytime性も報告している。
- [Mixture-of-Depths](https://arxiv.org/abs/2404.02258)は、top-k routingによって各層で処理するtokenを選択し、総計算budgetを固定しながらtoken単位で計算深度を動的に配分できることをTransformer language modelで示した。

これらは、階層的専門枝の自動形成、新しい枝の追加、cross-link、catastrophic forgetting改善を直接実証してはいない。その部分は本プロジェクトの研究仮説として扱う。

## 仮説

Fractal Canopyはforward routingだけでなく、global gradientを使わずに実活動経路へcredit候補を戻す階層構造としても評価する。Backward informationは使うが、Backward gradientは必須にしない。詳細は`hierarchical-local-credit-assignment.md`に定義する。

```text
shared trunk
  ├─ shallow reusable unit
  ├─ domain branch
  │    └─ specialist branch
  └─ cross-modal / reasoning branch
         └─ sparse cross-link
```

1. 簡単な入力は浅い経路で処理し、難しい入力だけ深い枝へ送ることで、同等品質あたりの計算量を削減できる。
2. 同じrouting／local processing／integration規則を複数階層で再利用すると、RISAの共有Unitと自然に接続できる。
3. 新規domainを既存trunkの全重みへ混ぜず、新しい小枝として追加すると、既存能力への干渉を減らせる可能性がある。
4. 完全なtreeでは表現できない多所属概念は、上限付きsparse cross-linkで補える。
5. branchの存在、利用頻度、予測利得、計算費用をKnowledge Serverへ明示保存すると、重みだけのroutingより説明・剪定・再利用が容易になる。

## 段階実験

### FC-0：routingを持たない基準系

- 同一parameter数のdense Transformer
- 同一FLOPsのdense Transformer
- 通常のMoEまたはflat router
- Mixture-of-Depths型token routing

### FC-1：固定Canopy

- 2〜4階層の固定branchを使う。
- 各階層で同一形式の`route → local transform → integrate`を適用する。
- branch数、最大深度、top-kを固定し、動的成長はまだ行わない。
- easy／hard sampleで実際の利用深度が分離するか測る。

### FC-2：Fractal path regularization

- 浅い経路と深い経路を同時に持たせる。
- branch drop-pathを導入し、特定経路への固定依存を防ぐ。
- early exitのconfidence calibrationを評価する。

### FC-3：Branch growth／pruning

- routing entropy、局所loss、prediction gain、利用頻度を成長候補指標にする。
- 新しいbranchは小さく追加し、既存branchをfreezeした条件とjoint training条件を比較する。
- 低利用かつ低予測利得のbranchだけをpruning候補にする。
- 削除ではなくinactive化し、復帰可能にする。

### FC-4：Sparse cross-link

- treeのみ、flat graph、上限付きcross-linkを比較する。
- cross-link総数、探索hop、同時活性branch数にhard budgetを設定する。
- routing collapseと計算爆発を監視する。

### FC-5：RISA／Knowledge Server接続

保存候補：

```text
branch definition
parent / cross-link
routing decision
activation count
prediction gain
compute cost
growth / prune proposal
model and dataset snapshot
```

これは本番Memory Schemaへ直ちに追加しない。toy experimentで再現性が確認された後に、Training Run artifactまたは研究専用schemaとして導入する。

## 評価指標

- validation loss／task accuracy
- token・sampleあたりFLOPs
- latency、peak memory、throughput
- easy／hard入力の平均利用深度
- router entropy、branch load balance、dead branch率
- 新規domain追加前後の既存task保持率
- branch追加あたりの性能利得／学習cost
- pruning後の回復可能性
- routing decisionの再現性と説明可能性

## 中止条件

- 同一FLOPsのMixture-of-Depths／MoEを安定して上回らない。
- routing overheadが節約FLOPsを相殺する。
- 専門化ではなくbranch collapseが繰り返される。
- branch追加で既存task保持率がdense continual-learning baselineより悪化する。
- cross-link数を厳しく制限すると効果が消える。

## Roadmap status

- [Later] FC-0〜FC-1：dense／MoD／flat MoEに対する固定Canopy toy benchmark
- [Later] FC-2：fractal pathとbranch drop-path／early exit
- [Later] FC-3：価値駆動branch growth／inactive pruning
- [Later] FC-4：budget付きsparse cross-link
- [Later] FC-5：RISA共有UnitおよびKnowledge Serverの実験履歴との接続

## English

The useful research target is not a visually fractal LLM, but hierarchical conditional computation that repeats the same routing and plasticity rule across scales. A second experiment must start from a minimal structure and test whether a canopy emerges instead of assuming its final shape. FractalNet supports mixed shallow/deep subpaths and path regularization; Mixture-of-Depths supports token-level dynamic depth under a fixed compute budget. Automatic branch growth, pruning, cross-links, and reduced forgetting remain project hypotheses and must be tested against compute-matched dense, MoD, and flat-MoE baselines.

The experiment proceeds from a fixed two-to-four-level canopy to path drop, controlled growth, reversible pruning, sparse cross-links, and only then RISA／Knowledge Server integration.

## 简体中文

值得研究的目标不是外观呈分形的LLM，而是在多个尺度重复相同路由与可塑性规则的层级条件计算。另一个实验必须从最小结构开始，检验Canopy能否自然形成，而不是预设最终形状。FractalNet支持浅层与深层子路径共存及路径正则化；Mixture-of-Depths支持固定计算预算下的token级动态深度。自动分支生长、剪枝、交叉连接和减少遗忘仍属于本项目假设，必须与计算量匹配的dense、MoD和flat-MoE基线比较。

实验应从固定两至四层Canopy开始，再逐步验证path drop、受控生长、可恢复剪枝、稀疏交叉连接，最后才连接RISA与Knowledge Server。
