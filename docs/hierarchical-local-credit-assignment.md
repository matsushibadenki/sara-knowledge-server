# Hierarchical Local Credit Assignment

## 日本語

## 研究ポリシー

本プロジェクトは、**global gradient Backpropagationを必須としないAI**を目指す。

これはBackward informationを禁止する方針ではない。出力側・上位構造・細胞体側から戻る情報は利用する。ただし、全体の計算graphを微分し、同一lossのgradientを全parameterへ正確に伝えることを学習成立の必須条件にしない。

```text
Backward information: 使用する
Backward gradient: 必須にしない
Global differentiability: 必須にしない
Local state and activity history: 使用する
Reward／prediction error／modulation: 使用する
Topology change: 学習対象に含める
```

研究課題は、**Backpropなしで、Backpropに近いcredit assignment能力をどこまで実現できるか**である。Backpropを比較対象から除外するのではなく、性能上限とcredit assignment品質を測るoracle baselineとして使用してよい。

## 基本ループ

このloopの実装部品、複数時間scale、最小構造からの自己形成については`industrial-neural-computational-primitives.md`に定義する。

```text
入力イベント
↓
局所活動
↓
他Unitとの相互作用
↙          ↓          ↘
STDP       bAP-like    modulation
↓          ↓          ↓
局所的可塑性＋eligibility trace
↓
network state／topology変化
↓
次のイベント
```

ここで`bAP-like`は、生物学的なbackpropagating action potentialそのものを実装済みだと主張する語ではない。Soma側の発火・状態・評価を直前に関与したbranchへ戻す、非gradientの局所Backward informationを表す研究上の抽象である。

## 階層的credit探索

```text
Soma
├─ A
│  ├─ A1 ← x1
│  └─ A2 ← x2
└─ B
   ├─ B1 ← x3
   └─ B2 ← x4
```

Somaに望ましい活動が起きた場合、偏微分を計算する代わりにactivity traceを構造に沿って辿る。

```text
Somaの結果
↓
直前に活動したbranchはどれか
↓
branch Aの寄与が高い
↓
A1とA2の局所traceを比較
↓
A1／x1へ限定的creditを割り当てる
```

暫定的な局所creditは次の要素から構成する。

```text
credit =
  local_activity
  × temporal_proximity
  × branch_contribution
  × eligibility_trace
  × global_or_regional_modulation
  × novelty
  × confidence
```

積だけに固定しない。値が一つゼロになると学習が完全停止するため、加算、対数空間、正規化、clippingを比較する。兄弟branch間でcredit budgetを正規化し、深い枝ほどcreditが機械的に消失しない補正も実験対象にする。

## Weight learningとTopology learning

```text
成功                 → 局所結合を強化
失敗／反予測         → 局所結合を弱化または抑制
反復する共同活動     → 接続候補
低利用＋低予測利得   → inactive pruning候補
新規相関＋高残差     → branch growth候補
文脈依存の競合       → branch分岐候補
```

pruningは初期段階では削除ではなくinactive化する。growth／merge／split／cross-linkは即時適用せずproposalとして保存し、replay評価後に確定する。

## Fractal Canopyとの統合

Fractal Canopyは単なるrouting構造ではなく、creditの探索空間を制限する構造として使う。

```text
Structural Plasticity
        ↑
        │
STDP ↔ Fractal Canopy ↔ Hierarchical Local Credit
        │
        ↓
Neuromodulation／prediction error／reward
```

全networkを逆向きに走査せず、実際に活動したCanopy subpathだけを辿る。これによりcredit計算量は全parameter数ではなく、active path長とactive branch数に近づく可能性がある。

## 必須の比較実験

### HLC-0：credit assignment toy benchmark

- delayed XOR、temporal parity、contextual bandit
- 時間遅延付きsequence association
- 分岐後にだけrewardが得られるtree task

比較対象：

- global Backprop／BPTT oracle
- Hebbian／STDPのみ
- reward-modulated STDP
- local activity＋eligibility trace
- hierarchical trace＋modulation

### HLC-1：構造ablation

- flat traceとtree trace
- parent feedbackなし／あり
- temporal proximityなし／あり
- sibling normalizationなし／あり
- noveltyなし／あり

### HLC-2：長期credit

- reward遅延を段階的に伸ばす。
- trace decay、replay、階層checkpointを比較する。
- gradient法との性能差がどの遅延で急増するか測る。
- fast traceだけに依存せず、圧縮Event Memoryからactive pathを再生する条件を比較する。
- point-neuron／multi-branch双方のsurrogate-gradient SNNを必須baselineに含める。

### HLC-3：Topology plasticity

- weight更新のみ
- growthのみ
- pruningのみ
- weight＋growth＋reversible pruning

### HLC-4：Fractal Canopy／SNN

- active pathだけへのcredit伝達
- spike timingとbranch contributionの統合
- easy／hard taskで深度とcredit範囲が変わるか
- cross-linkがcredit leakageを起こす条件

## 評価指標

- task performanceとsample efficiency
- Backprop oracleに対する性能比
- 真の因果入力へ割り当てたcredit精度
- distractor synapseへのcredit leakage
- credit計算量、memory量、通信量
- reward遅延への耐性
- catastrophic forgettingと既存task保持率
- branch growth数、inactive率、再活性化成功率
- seed間分散と再現性

## 失敗条件

- creditが活動頻度だけに支配され、因果寄与を識別できない。
- 深度とともにcreditが消失またはroot近傍へ集中する。
- global rewardで無関係branchまで同時強化される。
- topology growthが無制限に続き、性能利得を上回る。
- Backpropとの差がtoy taskでも縮まらず、Hebbian baselineも安定して上回れない。

## Knowledge Serverへ保存する候補

実験段階では本番Memory Schemaへ直ちに追加しない。Training Run artifactとして次を保存する。

```text
active path
local activity trace
eligibility trace
modulation event
assigned credit
weight update
growth／prune proposal
before／after topology snapshot
reward delay
prediction gain
```

再現性と有効性が確認された後、credit event／plasticity proposal専用schemaを検討する。

## English

The project policy is to make global-gradient Backpropagation optional, not to prohibit backward information. Soma-, output-, reward-, context-, and prediction-derived signals may travel backward, but learning must not require exact gradients of one global loss through the full graph.

The core hypothesis is hierarchical local credit assignment: follow only recently active branches, combine local activity, temporal proximity, eligibility, branch contribution, modulation, novelty, and confidence, then update both weights and topology. Global Backprop／BPTT remains an oracle baseline for measuring the credit-assignment gap.

## 简体中文

项目方针是让全局梯度反向传播不再成为必需条件，而不是禁止反向信息。来自Soma、输出、奖励、上下文和预测误差的信息可以向后传递，但学习不应依赖对整个计算图和单一全局损失进行精确求导。

核心假设是层级局部信用分配：只沿最近实际激活的分支回溯，结合局部活动、时间接近度、eligibility、分支贡献、调制、新颖性和置信度，同时更新权重与拓扑。全局Backprop／BPTT保留为衡量信用分配差距的oracle基线。

## Roadmap status

- [Later] HLC-0：Backprop oracleを含むlocal credit toy benchmark
- [Later] HLC-1：階層・時間・modulation・normalization ablation
- [Later] HLC-2：delayed reward、eligibility decay、replay
- [Later] HLC-3：weight learning＋growth＋reversible pruning
- [Later] HLC-4：Fractal Canopy／SNN active-path credit assignment
