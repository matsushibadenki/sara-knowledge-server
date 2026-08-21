# Spectral Neuronの評価と限定採用

## 結論

プレプリント`The Spectral Neuron`は、RISAの記憶構造やニューロンモデルとして直接採用しない。一方、構造候補のStability、Value、Review Priorityなどを計算する**制約付き・説明可能な補助scorer候補**として、次の原則を限定採用する。

- 入力特徴の影響上限をモデル構造から計算する
- 単調性など、正しいことが分かっている形状制約を構築時に保証する
- 固有値だけでなくeigengapとeigenspaceの安定性を監視する
- 行列の各成分ではなく、直交基底変換で不変な量を解釈・比較する
- モデル精度だけでなく、制約違反、説明安定性、計算費用を評価する

これは`[Later]`の研究候補であり、現在のAPI、DB Schema、RISA表現形式は変更しない。

確認対象:

- Alex Shtoff, [The Spectral Neuron, arXiv:2608.08003v2](https://arxiv.org/abs/2608.08003)
- [実験コード](https://github.com/alexshtf/spectral_neuron_paper)
- 確認日: 2026-08-21

## モデルの概要

論文は次のスカラー関数を扱う。

```text
f_k(x) = λ_k(A_0 + Σ_i x_i A_i)
```

`A_i`は学習される実対称行列、`λ_k`は小さい方から`k`番目の固有値である。入力は行列へアフィンに入るが、固有値を読むことで非線形な出力になる。

論文が示す主な性質:

- 行列次元を増やすと表現力を増やせる
- 最小固有値は入力についてconcave、最大固有値はconvexになる
- 係数行列をpositive / negative semidefiniteに制約すると、対象特徴について単調増加 / 単調減少を保証できる
- `||A_i||_2`が特徴`i`の変化に対する出力変化の大域的上限になる
- 選択されたeigenspaceから局所的な特徴影響を調べられる

実験は合成関数、Criteo、HIGGSを中心とした表形式の予測であり、RISAの構造形成、時系列イベント、知識グラフ、SNNを直接評価したものではない。

## RISAで採用する部分

### 1. 形状制約付きscorer

Stability Profileや価値駆動学習では、意味が明確な単調制約がある。

例:

```text
独立source数が増える
→ 他条件が同じならevidential supportを下げない

再現可能な予測成功が増える
→ 他条件が同じならpredictive supportを下げない

反例率やcalibration errorが増える
→ 他条件が同じならsupportを上げない
```

このようなスコアを学習する場合、データ拡張やpenaltyで単調性を期待するだけでなく、モデル構造で保証できる候補としてSpectral Neuronを比較する。

入力例:

```text
x = [
  independent_source_count,
  source_diversity,
  prediction_success_rate,
  counterexample_rate,
  prediction_error_ema,
  calibration_error,
  context_diversity,
  replay_survival_rate,
  recency,
  compute_cost
]
```

用途候補:

- structure stability score
- training value score
- review priority score
- consolidation priority score

ただし、一つのscalarへ全判断を潰さない。スコアの内訳と元のStability Profileを常に保持する。

### 2. 特徴影響の大域的上限

Spectral Neuronでは、特徴`i`の単位変化による出力変化を`||A_i||_2`で上から制限できる。この考えを、scorerの監査へ利用する。

- どの入力特徴がスコアを大きく動かし得るか
- 一つの特徴変更で最大どれだけpriorityが変わるか
- source countなどの頻度特徴が過度に支配していないか
- 変更前後で影響上限がどう変わったか

ただし上限が実際の変化より大幅に緩い場合があるため、理論上限と観測された感度の両方を保存する。

### 3. eigengapを説明安定性として扱う

選択固有値と近傍固有値のgapが小さいと、入力や行列の小さな変化で対応eigenspaceが大きく変化し得る。

したがって、局所説明や特徴影響を保存するときは次を併記する。

```text
selected_eigenvalue
eigengap
eigenspace_projector
local_feature_influence
perturbation_size
```

小さいeigengapで得られた説明は、予測値が安定して見えても`explanation_unstable`候補として扱う。

### 4. 基底不変な解釈

共通の直交変換を行ってもモデルの出力は変わらない。そのため、学習行列の個々の行・列・固有ベクトル座標に固定的な意味を付けない。

比較・監査には次のような基底不変量を優先する。

- eigenvalue
- spectral norm
- eigengap
- eigenspace projector
- principal angle
- projector distance
- shape constraintの充足状態

これはRISAの名前のないlatent Unitにも重要である。内部座標が変わっても同じ機能を持つ表現を、別概念として重複登録しないための原則として利用できる。

## 採用しない部分

### RISAの基本記憶単位にはしない

対称行列は無向・相互的な相互作用の表現には適するが、RISAが必要とする有向relation、時間順序、非対称な因果、役割、provenanceを単独では表現できない。

```text
Structure / Delta / Transformation / Event
→ 正本となる明示・監査表現

Spectral scorer
→ それらを評価する任意の補助モデル
```

### 生物学的ニューロンとはみなさない

名称は`Spectral Neuron`だが、脳細胞がこの固有値計算を行っている証拠を示す研究ではない。RISAとSNNの生物学的妥当性の根拠には使わない。

### 汎用Verifierにはしない

単調性や感度上限は、出典の正しさ、論理的一貫性、倫理、安全性を保証しない。`dynamically_supported`や高いspectral scoreを`verified`へ自動変換しない。

## 制約とリスク

- 2026年8月時点のpreprintであり、peer review前である
- 密な`d × d`行列は特徴ごとに`O(d^2)`parameterを必要とする
- 密な固有値計算は概ね`O(d^3)`で、線形modelより大幅に高価である
- 学習ではgradientのためeigenvectorも必要になる
- 固有値が接近・重複するとgradientや局所説明が不安定になり得る
- 初期行列が同時対角化可能な状態へ入ると、より単純なpiecewise-linear familyから抜けにくい
- 行列dimensionが増えるほど理論的な感度上限が緩くなる可能性がある
- 公開実験は主に表形式データで、RISA用途の有効性は未検証である

低コスト性が重要な本プロジェクトでは、Logistic Regression、GAM、単調GBDT、small MLPなどより明確な利点がない限り採用しない。必要なら低dimension、tridiagonal、low-rankなどを別ablationとして評価する。

## 実験方針

同じStability / Value予測課題で次を比較する。

```text
手書きrule
Logistic Regression
GAM / monotonic model
Tree model
small MLP
Spectral Neuron
```

評価指標:

- held-out predictionとcalibration
- 単調性・convexityなどの制約違反数
- 大域的特徴影響上限のtightness
- eigengapと説明変動の関係
- source重複・外れ値への耐性
- parameter数、学習時間、推論時間、memory使用量
- 学習seed間の安定性
- 人間が説明を検証する時間

採用条件:

- 必要なshape constraintを違反なく満たす
- 単純なbaselineより予測、説明可能性、制御性のいずれかを明確に改善する
- CPU中心の運用で許容可能な費用に収まる
- eigengapを含む説明安定性を監査できる
- model artifact、入力Schema、学習データVersion、seed、code commitを再現できる

## 保存方針

専用DB Schemaは追加しない。既存または将来の次の単位を使う。

```text
training.models
training.runs
training.metrics
training.outputs
MinIO
system.audit_logs
```

PostgreSQLにはmodel family、matrix dimension、eigenvalue index、shape constraints、入力Schema、artifact hash、MinIO object key、学習データVersion、code commit、指標を保存する。行列本体や大きなcheckpointはMinIOへ保存する。専用artifact tableが必要かは、実験後に既存の`training.outputs`との責務を比較して決める。

## 実装段階

- [Done] Source APIとRecordの出典追跡基盤
- [Next] Source・Record変更の監査ログを優先する
- [Later] Stability Profileのbaseline datasetを作成する
- [Later] 小dimensionのSpectral Neuron scorerを独立experimentとして再現する
- [Later] 単純なbaselineとの精度・制約・費用比較を行う
- [Later] eigengapと説明安定性を検証する
- [Later] 採用条件を満たした場合だけRISA scorer adapterを検討する

## 最終判断

この論文から採用するのは、Spectral Neuronそのものではなく、**表現力を増やしても、制約、感度上限、説明安定性を数学的に監査できるモデルを優先する**という設計原則である。
