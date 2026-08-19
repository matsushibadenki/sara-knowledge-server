# 力学的な構造検証

## 設計判断

RISAの構造検証に、独立した高性能Verifierだけではなく、単純な局所更新の反復から構造の支持度を評価する**力学的検証層**を採用する。

```text
構造を読んで一度に正誤判定する
ではなく
構造を再生し、予測、観測、競合、誤差、再現性から
文脈ごとの安定性を継続更新する
```

ただし、安定性は真理と同義ではない。頻出する偏見、重複データ、組織的な誤情報、交絡も安定し得る。力学的検証は低コストな一次選別・信頼度更新として使い、出典検証、外部資料、ルール、人間レビューを置き換えない。

## 検証を分解する

「検証済み」を単一の尺度にしない。

```text
predictive support
= その構造が観測をどれだけ予測できたか

dynamical stability
= replay、競合、時間経過後にも活動パターンが維持されたか

evidential support
= 独立した出典、観測、反例がどれだけあるか

external verification
= 人間、承認済みルール、信頼できる外部資料で確認されたか
```

`dynamically_supported`であることを`verified`へ自動的に読み替えない。

## 基本ループ

```text
1. Event Memoryへ新規観測を不変保存
2. 関連するStructure / Unit / Assemblyをtop-k活性化
3. 各候補から次状態または欠損関係の分布を予測
4. 実観測との予測誤差を計算
5. 成功・失敗・反例を文脈別に記録
6. 共有部分は共鳴、排他的な分岐は競合として記録
7. 更新量を上限付きで反映
8. 活動・結合の総量を恒常的な予算内へ正規化
9. replay queueで異なる順序・時期に再評価
10. 十分な支持と安定性を持つ候補だけ長期構造候補へ送る
```

新しい観測を既存知識へ即時統合せず、一時的なEvent Memoryと長期Structureの間にreplay・consolidation段階を置く。

## 予測誤差

候補構造`S`が文脈`c`で予測`p`を出し、観測`x`を受け取ったとき、局所的な誤差を記録する。

```text
error = loss(x, p)
```

単純な値差だけに限定せず、分類分布、時間差、状態遷移、構造欠損などに応じたlossを選択する。平均誤差だけでは変化を見失うため、次を分離して保持する。

- 直近の誤差
- 指数移動平均
- 長期平均
- 文脈別平均
- calibration error
- 反例数
- 変化点候補

予測誤差が大きいとき、既存構造を即削除しない。次の候補を並行して作る。

- 既存構造の信頼度低下
- 文脈限定
- 新しい分岐
- 例外
- 環境変化
- センサーまたは出典異常

## 共鳴と競合

```text
S1: A → B → C
S2: A → B → D
```

`A → B`は共有Unitとして共鳴でき、`C`と`D`は同じ文脈・時刻・役割で排他的な場合に競合する。ただし異なる文脈で両立する場合は競合させない。

競合は削除命令ではなく、分岐分布として保持する。

```text
P(C | A, B, context)
P(D | A, B, context)
```

winner-take-allで少数例を消さず、support、counterexample、source diversity、recency、contextを保持する。環境変化で優勢経路が入れ替わることを許容する。

## 時間依存の局所更新

STDPからは「順序と時間差によって更新方向・強度を変える」という計算原理だけを取り入れる。

```text
Δstrength = f(Δt, prediction_success, context, confidence)
```

RISAの更新を生物学的STDPと同一視しない。イベント順序、許容時間窓、遅延分布を扱うための複数候補の一つとして比較する。

## 恒常性

Hebbian型の強化だけでは、頻出構造が際限なく強くなる。次の恒常性制約を設ける。

- Unitまたは文脈ごとの総活性予算
- 1観測あたりの最大更新量
- source重複を考慮した有効証拠数
- 過剰に優勢な経路の更新減衰
- 未使用構造の休眠
- 低頻度でも高い予測利得を持つ構造の保護
- context diversityの要求

正規化後も、元の観測回数、重み付け前の証拠、更新式、engine versionを失わない。

## Replayと二段階統合

高速なエピソード保存と緩やかな長期統合を分離する。

```text
Event Memory
→ Structure Candidate
→ sandbox replay
→ Resonance / Conflict / Prediction Error
→ consolidation proposal
→ 検証
→ Long-term Structure
```

Replayでは次を評価する。

- 過去の代表例と反例を再現できるか
- 入力順を変えても結論が極端に変わらないか
- 新候補が既存の重要な予測を壊さないか
- 特定sourceの重複だけで支持されていないか
- held-out eventで予測が改善するか
- rollback後に元状態を再現できるか

Replay結果は確定知識ではなく、導出可能なproposalとして保存する。

## Stability Profile

構造の安定性を単一scoreだけで保存しない。

```text
activation_count
prediction_success_count
prediction_failure_count
prediction_error_ema
calibration_error
support_count
counterexample_count
independent_source_count
context_diversity
conflict_entropy
replay_survival_count
stability_score
change_point_score
last_activated_at
last_evaluated_at
```

`stability_score`は一覧や候補絞り込みに利用できるが、判断時には内訳と導出式を参照する。

## 将来の保存候補

### `memory.structure_stability_profiles`

Structure、Pattern、Unit、Transformationごとの文脈別Stability Profileを保存する。

### `memory.structure_predictions`

予測時点の入力、候補構造、予測分布、予測対象時間、実観測、loss、engine versionを不変保存する。

### `memory.structure_competitions`

共有prefix、競合した分岐、排他条件、文脈、活性値、正規化前後の強度を保存する。

### `memory.replay_runs`

Replay対象、入力順、保持データ、評価結果、回帰、採用・却下理由を保存する。

これらは実装済みテーブルではない。toy experimentで更新則と必要な監査情報を確認してからschemaを確定する。

## Knowledge ServerとRISAの責務

```text
RISA / SARA Engine
= 活性化、予測、loss計算、競合、局所更新、
  恒常性、replay、consolidation proposal

SARA Knowledge Server
= 元Event、予測結果、Stability Profile、競合履歴、
  replay run、出典、反例、engine version、監査ログの正本
```

Knowledge Serverは、RISAが出した安定度を無条件にverification stateへ変換しない。

## 外部Verifierが必要な場面

次の検証は、局所ダイナミクスだけでは扱えない。

- 出典が実在し、引用内容と一致するか
- 法律、医療、安全などの規範・高リスク判断
- 数学的証明や厳密な制約充足
- データ汚染、談合、重複sourceの検出
- 倫理的・社会的に許容されるか
- 観測できない事実の確認

これらには、人間、外部資料、ルール、形式検証、複数モデルなどを利用する。

## 評価

比較対象:

```text
固定thresholdだけ
LLM Verifierだけ
力学的検証だけ
力学的検証 + 出典・ルール・人間レビュー
```

指標:

- held-out予測精度とcalibration
- 反例を受けた後の適応速度
- 環境変化後の分岐更新速度
- 少数例・例外保持率
- replay後の回帰率
- 誤った構造の長期残存率
- 正しい低頻度構造の消失率
- source重複への耐性
- Verifierまたは人間レビュー削減量
- 1 Eventあたりの計算コスト
- 更新・取消の再現率

## 失敗条件

- 安定性を真実と同一視する
- 重複入力を独立証拠として数える
- 頻出構造が全活性を独占する
- winner-take-allで例外や少数派を消す
- 文脈違いの分岐を誤って競合させる
- 一度の異常値で長期構造を破壊する
- replayが過去データの丸暗記に留まる
- 更新式やengine versionがなく再現できない
- 外部検証が必要な事実まで自動昇格する

## 実装段階

- [Next] Source APIで観測・予測・反例の出典を追跡可能にする
- [Later] 小規模イベント列で予測誤差と分岐統計を実装する
- [Later] 上限付き更新と恒常性budgetを比較する
- [Later] Event Memoryからのsandbox replayを実装する
- [Later] Stability Profileと構造候補の監査表示を作る
- [Later] LLM Verifier単体との精度・費用・レビュー量を比較する
- [Later] SNNの時空間活動パターンを使う方式と比較する

## 参考資料

- Rao, R. P. N. & Ballard, D. H. (1999), [Predictive coding in the visual cortex](https://doi.org/10.1038/4580)
- Bi, G. Q. & Poo, M. M. (1998), [Synaptic modifications in cultured hippocampal neurons](https://doi.org/10.1523/JNEUROSCI.18-24-10464.1998)
- Turrigiano, G. G. et al. (1998), [Activity-dependent scaling of quantal amplitude in neocortical neurons](https://doi.org/10.1038/36103)
- McClelland, J. L., McNaughton, B. L. & O'Reilly, R. C. (1995), [Why There Are Complementary Learning Systems in the Hippocampus and Neocortex](https://doi.org/10.1037/0033-295X.102.3.419)

## 結論

RISAでは構造検証を、知的な正誤判定だけに限定しない。構造を再生したときの予測誤差、共鳴、競合、時間的一貫性、replay耐性を蓄積し、再現性のある構造が長期候補として安定する計算系を研究する。

同時に、動力学的に安定な誤りも存在することを前提とし、出典と外部検証を分離して保持する。
