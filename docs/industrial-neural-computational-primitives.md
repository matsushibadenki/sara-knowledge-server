# Industrial Neural Computational Primitives

## 日本語

## 目的

本研究は脳を原子・分子レベルで複製しない。脳に見られる計算原理を、検証・交換・計測可能な工業的computational primitiveへ置換する。

```text
入力イベント
↓
局所樹状計算
↓
Soma相当の統合
↓
Spike／Event
↓
局所・再帰networkとの相互作用
↓
局所可塑性＋構造可塑性
↓
次の入力イベント
```

目標は生物学的忠実度ではなく、次の能力を少ない共通部品で再現できるかである。

1. branch内の局所非線形計算
2. event／spikeによる時間表現
3. 局所synaptic plasticity
4. Soma側からbranchへ戻る非gradient activity information
5. reward、context、prediction errorに相当するmodulation
6. branchのgrowth、split、merge、inactive化
7. Unit間のrecurrent interaction
8. fast state、eligibility、long-term structureという複数時間scale

## 最小部品

### Dendritic Local Unit

```text
x1 ─┐
x2 ─┼→ Local Unit A ─┐
x3 ─┘                 │
                      ├→ Integration Unit → Event
x4 ─┐                 │
x5 ─┼→ Local Unit B ─┘
x6 ─┘
```

Local Unitが持つ状態候補：

```text
membrane_state
recent_activity
eligibility_trace
local_threshold
synaptic_strength
prediction_state
last_event_time
modulation_sensitivity
```

計算形式は単一加重和ではなく、概念的に次とする。

```text
event = Integrate(
  F_A(x1, x2, x3, local_state_A, time),
  F_B(x4, x5, x6, local_state_B, time),
  soma_state,
  modulation
)
```

`F_A`と`F_B`は巨大モデルにしない。加重和＋threshold、small MLP、coincidence detector、state machineなどを同一interfaceで比較可能にする。

### Integration／Soma Unit

- 複数branchの出力を統合する。
- 発火、抑制、保留、予測などのEventを生成する。
- 直前に寄与したbranchへbAP-like activity signalを返す。
- gradientを配信する必要はない。

### Modulation Channel

- reward、prediction error、novelty、context、homeostatic pressureを運ぶ。
- 全Unitへ同じ値を無差別broadcastせず、scope、delay、decay、receptor profileを持たせる。
- global rewardによる無関係branchの誤強化を防ぐ。

### Structural Plasticity Controller

- growth／split／merge／cross-link／inactive proposalを生成する。
- 即時に構造を変更せず、replayとheld-out評価を通す。
- hard budgetとしてUnit数、branch数、fan-in／fan-out、cross-link数、energy proxyを制限する。

## 学習装置をnetwork内部へ分散する

Deep Learningのように`Network + external optimizer`を唯一の形にしない。各Unitが同じevent loop内で、計算、短期履歴、時間関係、feedback受信、local update proposalを行う。

```text
Unit
├─ forward／event computation
├─ recent trace update
├─ temporal relation update
├─ backward information reception
├─ local credit estimation
├─ weight update proposal
└─ topology update proposal
```

ただし「完全分散」を教義にしない。研究用coordinatorはbudget enforcement、checkpoint、replay scheduling、評価、rollbackを担当できる。coordinatorが全parameterのgradientを計算しないことが重要である。

## フラクタルなのは形ではなくアルゴリズム

Canopy形状を最初から完成形として与えない。最小構造から開始し、同じ局所則を複数scaleで適用した結果として階層構造が形成されるかを検証する。

```text
Local Unit
  ↓ 同じ原理
Neuron-like Assembly
  ↓ 同じ原理
Local Circuit
  ↓ 同じ原理
Module
  ↓ 同じ原理
Global Workspace
```

各scaleで反復する原理：

```text
local processing
→ integration
→ event
→ backward information
→ local credit
→ plasticity
```

自己相似性が現れなかった場合も失敗ではない。どのscaleで別のruleが必要になるかを特定することが成果になる。

## Emergent Canopy実験

### ICP-0：固定構造の最小Unit

- branch 2本、各branch 2〜4入力から始める。
- dendritic local nonlinearityの有無を比較する。
- ANN neuron、multi-branch Unit、small MLPをparameter／compute matchingする。

### ICP-1：局所可塑性を内蔵

- STDP only
- reward-modulated STDP
- eligibility＋bAP-like branch signal
- hierarchical local credit

学習中と推論中に同じevent mechanismを使用できるか測る。

### ICP-2：成長とinactive pruning

- 初期Canopyを与えず、最小treeから始める。
- persistent residual、repeated co-activity、context conflictをgrowth trigger候補にする。
- low useだけではpruneせず、low use＋low prediction gain＋replay nonessentialを要求する。

### ICP-3：複数scale

- Unit内部だけにplasticityを置く条件
- Unit間だけに置く条件
- 両scaleへ同じruleを置く条件
- scale固有ruleを置く条件

自己相似algorithmが性能、計算量、安定性に寄与するか比較する。

### ICP-4：Recurrenceと複数時間scale

- fast membrane state
- medium eligibility／working trace
- slow weight／threshold adaptation
- very slow topology change

時間scaleを混同せず、更新頻度と保存期間を独立制御する。

### ICP-5：Online continual learning

- 学習modeと推論modeを完全分離しない。
- streaming eventから局所更新する。
- domain追加後の既存能力保持、回復、必要計算領域を測る。

## 最大の未解決問題

長距離credit assignmentを最優先riskとする。数分・数日・多数event前の原因へ、局所traceだけでcreditを戻せるとは仮定しない。

SNN学習が解決済みであるとは扱わない。詳細な反証条件、surrogate-gradient baseline、多時間スケールEvent Memory実験は`snn-learning-open-problems.md`に定義する。

比較対象：

- eligibility decay
- hierarchical checkpoint
- event replay
- episodic memory retrieval
- multi-timescale modulation
- structural path trace
- global Backprop／BPTT oracle

中心的な研究問いは次である。

> Backpropを捨てることではなく、局所的な自己組織化だけから大域的な知性と長距離credit assignmentをどこまで発生させられるか。

## 成功条件

- global gradientなしでも、局所Unitが因果寄与をHebbian baselineより正確に識別する。
- hard structural budget内で必要なbranchが成長し、不要構造が可逆的にinactive化する。
- online更新後も既存task保持率が明確に高い。
- easy inputでは局所計算だけ、hard inputでは深い／横断的計算が起こる。
- 学習と推論で同じevent-driven mechanismを維持できる。
- 形状を指定しなくても再利用可能な階層またはmoduleが再現性をもって形成される。

## English

The goal is not molecular brain copying. It is to replace candidate neural computational principles with measurable industrial primitives: dendritic local nonlinearities, event timing, local eligibility, backward non-gradient activity information, scoped modulation, recurrence, multiple memory timescales, and reversible structural plasticity.

The fractal hypothesis concerns the repeated algorithm—local processing, integration, event generation, backward information, local credit, and plasticity—not a predesigned tree shape. Experiments begin with minimal structures and test whether reusable hierarchy emerges under hard compute and topology budgets.

## 简体中文

目标不是在原子或分子层面复制大脑，而是把候选神经计算原理替换为可测量、可交换的工业部件：树突局部非线性、事件时间、局部eligibility、非梯度反向活动信息、受范围限制的调制、递归连接、多时间尺度记忆以及可恢复的结构可塑性。

分形假设指的是重复算法——局部处理、整合、事件生成、反向信息、局部信用和可塑性——而不是预先设计好的树形。实验从最小结构开始，在严格计算与拓扑预算下检验可复用层级是否自然形成。

## Roadmap status

- [Later] ICP-0〜ICP-1：工業的Dendritic／Soma Unitと内蔵local learning
- [Later] ICP-2：最小構造からのgrowth／reversible inactive pruning
- [Later] ICP-3：Unit・Circuit・Module間のalgorithmic self-similarity
- [Later] ICP-4：recurrenceとfast／medium／slow／topology時間scale
- [Later] ICP-5：同一event mechanismによるonline continual learning
