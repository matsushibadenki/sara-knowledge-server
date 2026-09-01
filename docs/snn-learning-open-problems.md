# SNN Learning — Open Problems and Testable Hypothesis

## 日本語

## 現在の結論

SNNタイプの学習問題は**解決済みではない**。

本プロジェクトで得られたのは解決ではなく、従来の問題設定を分解する検証可能な仮説である。

> SNNの学習困難性はspikeの非微分性だけでなく、Unitを単純な点演算器として扱い、階層的局所計算、eligibility、Backward information、modulation、構造可塑性、多時間スケール記憶を省略したことにも起因するのではないか。

この仮説が正しくても、global gradientなしで大規模・長距離credit assignmentが成立するとはまだ言えない。Transformer、Backprop ANN、surrogate-gradient SNNへ迫る再現可能な結果が出るまで「解決」と表現しない。

## Point Neuron仮説との比較

基準となるpoint-neuron SNN：

```text
x1 ─w1─┐
x2 ─w2─┼→ LIF Unit → spike
x3 ─w3─┘
```

検証対象となるmulti-branch Unit：

```text
x1 ─┐
x2 ─┴→ Branch A ─┐
                   ├→ Soma／Integrator → spike／event
x3 ─┐             │
x4 ─┴→ Branch B ─┘
```

multi-branch Unitは、百万synapseからrewardへ直接creditを割り当てず、次のように候補を段階的に絞る。

```text
outcome
→ module contribution
→ branch contribution
→ sub-branch eligibility
→ local synapse trace
```

これは正しいcreditを保証しない。探索空間と通信範囲を構造で制限する仮説である。誤ったbranchが高活動だった場合には誤creditが起こるため、activityだけでなくprediction gain、counterfactual ablation、competition、replay consistencyを比較する。

## 多時間スケールCredit Memory

長距離creditをUnit内部のeligibility traceだけで保持しない。

```text
Fast trace
  数ms〜秒：spike timing、local activity、branch eligibility
↓
Medium trace
  秒〜分：module activation、working context、modulation history
↓
Event Memory
  分〜日：圧縮されたactive path、state transition、outcome待ちepisode
↓
Structural Memory
  長期：安定したbranch、relation、topology、transformation
```

Outcomeが遅れて到着した場合：

```text
Outcome／error／reward
↓
関連Event Memoryを検索
↓
候補module／branch pathを再生
↓
local eligibilityを再構成または近似
↓
限定的plasticity proposal
↓
replay／held-out検証
```

Event Memoryは「過去の全spike」を保存しない。active path、重要state transition、prediction、novelty、未解決outcome handleを圧縮保存する。保存量とcredit精度のtrade-offを測定する。

## Knowledge Serverとの役割分担

Knowledge Serverはonline SNNの全内部状態をリアルタイムDBへ書き込む装置ではない。

- SARA Engine：fast／medium trace、spike、即時local plasticity
- Event Memory：episode、active path summary、遅延outcome handle
- Knowledge Server：長期保存、provenance、replay manifest、評価、topology version、credit proposal監査

通常VPS上のSARA Engineは、署名付きHTTPS APIまたはjob queueを通してKnowledge Serverへsummaryを送る。Managed PostgreSQLへの直接接続には依存しない。

## 必須Baseline

- dense ANN＋global Backprop／BPTT
- point-neuron SNN＋surrogate gradient
- point-neuron SNN＋STDP
- reward-modulated STDP／three-factor rule
- multi-branch SNN＋surrogate gradient
- multi-branch SNN＋hierarchical local credit
- multi-branch SNN＋hierarchical local credit＋Event Memory replay

multi-branch構造の効果とlocal learningの効果を混同しないため、`multi-branch＋surrogate gradient`を必ず含める。

## 実験系列

### SNN-L0：局所因果credit

- distractor入力を含むbranching task
- 真の因果synapseへのcredit precision／recall
- activity frequency biasとcredit leakage

### SNN-L1：深さ

- chain型、tree型、balanced hierarchyを同一Unit数で比較する。
- task depthを増やし、性能・通信量・credit消失を測る。

### SNN-L2：遅延

- reward delayをms、秒、分相当へ段階化する。
- fast traceだけ、multi-timescale trace、Event Memory replayを比較する。

### SNN-L3：構造可塑性

- weight only
- fixed multi-branch
- growth／split
- growth＋reversible inactive pruning

### SNN-L4：継続学習

- task sequenceをonline入力する。
- 新task適応、既存task保持、branch再利用、計算局所性を測る。

### SNN-L5：言語／長系列への拡張判定

toy taskで明確な効果が出た場合だけ、小規模sequence modelingへ進む。数千token相当へ進む前に、遅延credit曲線と保存costが許容範囲であることをgateとする。

## 失敗・反証条件

- multi-branch構造がpoint neuronより良くても、surrogate gradientでしか学習できない。
- hierarchical local creditがreward-modulated STDPを安定して上回らない。
- Event Memory量がsequence長へほぼ線形に増え、圧縮効果がない。
- 遅延outcomeで無関係なepisode／branchへcreditが拡散する。
- 局所的な改善がglobal task performanceを悪化させる。
- topology growthで改善するが、同一parameter budgetの固定networkを上回らない。

## English

SNN learning is not solved. The project has a testable reframing: difficulty may arise not only from non-differentiable spikes, but also from reducing neurons to point operators and omitting hierarchical dendritic computation, eligibility, backward information, modulation, structural plasticity, and multiple credit-memory timescales.

Long-range credit is split across fast local traces, medium module traces, compressed episodic Event Memory, and slow Structural Memory. This remains a hypothesis. Dense Backprop／BPTT and surrogate-gradient SNNs remain mandatory baselines, including a multi-branch surrogate-gradient model that separates architecture gains from learning-rule gains.

## 简体中文

SNN学习问题尚未解决。本项目提出的是一个可检验的重新表述：困难可能不仅来自脉冲不可微，还来自把神经元简化为点运算器，并省略层级树突计算、eligibility、反向信息、调制、结构可塑性以及多时间尺度信用记忆。

长距离信用被分配到快速局部trace、中期module trace、压缩的情节Event Memory和慢速Structural Memory中。这仍是假设。Dense Backprop／BPTT与surrogate-gradient SNN必须作为基线，并且必须包含multi-branch surrogate-gradient模型，以区分结构收益与学习规则收益。

## Roadmap status

- [Later] SNN-L0〜L1：local causal creditとchain／tree／hierarchy比較
- [Later] SNN-L2：multi-timescale trace＋Event Memory delayed-credit benchmark
- [Later] SNN-L3〜L4：topology plasticityとonline continual learning
- [Later] SNN-L5：gate付き小規模language／long-sequence拡張

