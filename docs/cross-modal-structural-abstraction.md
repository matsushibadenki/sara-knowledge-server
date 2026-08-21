# クロスモーダル構造抽象化

## 採用する研究仮説

文章、映像、音・音楽、触覚信号には固有の値と物理的実現がある一方、状態、差分、順序、反復、境界、関係、変換、予測誤差などの一部は複数モダリティで再利用できる可能性がある。

RISAの研究テーマとして、モダリティ固有表現を失わずに、複数モダリティ間で予測・推論へ再利用できるStructural Factor候補を発見する**Cross-modal Structural Abstraction**を追加する。

```text
modality-native observation
→ 専用Encoder
→ native value / feature / residual
→ modality-specific Structure
→ cross-modal Factor candidate
→ structural reasoning
→ 対象modalityのDecoderまたは行動
```

> **English:** Cross-modal structural abstraction studies whether typed relations and transformations can transfer across modalities without discarding modality-native values and residuals.
>
> **简体中文：** 跨模态结构抽象研究带类型的关系与变换能否在不同模态间迁移，同时保留各模态固有的数值和残差信息。

検証前から`Universal Structure Space`の存在を前提にしない。初期名称は`cross-modal structure candidate space`とし、複数モダリティへの転移が確認されたFactorだけを段階的に共有範囲の広い候補として扱う。

## モダリティの扱い

文章、映像、音楽、触覚を同種の生データとはみなさない。

- 文章は語彙、統語、参照、意味役割を持つ記号系列
- 映像は空間、色、輝度、奥行き、運動を持つ時空間信号
- 音は周波数、振幅、位相、音色を持つ時間信号
- 音楽は音響だけでなく、文化的・記号的な規則を含み得る
- 触覚は圧力、振動、温度、剪断、身体位置などを持つ身体依存信号

したがって、入力座標、sensor calibration、単位、欠損、時間解像度を共通構造へ潰さない。

## 表現境界

具体経験を次の組として扱う。

```text
Experience
= Modality-native values
+ Modality-specific Structure
+ Cross-modal Factor candidates
+ Residual
+ Provenance / alignment
```

### Modality-native value

画素、Hz、Pa、N、温度、tokenなど、元の計測・記号座標に依存する値。単位とcalibrationを保持する。

### Modality-specific Structure

補色関係、倍音構造、痛覚特性、統語依存など、関係であっても対象モダリティまたは文化・身体条件へ強く依存する構造。

### Cross-modal Factor candidate

異なるモダリティのbindingへ適用したとき、対象側の予測、再構成、行動選択、異常検知のいずれかを改善する型付き関係または変換候補。

候補例:

```text
STATE(X, t)
INCREASE(value, t1, t2)
REPEAT(pattern, interval)
ORDER(A, B)
APPROACH(A, B)
CONTACT(A, B)
TRANSITION(S1, S2)
PREDICTION_ERROR(expected, observed)
```

これは確定Primitive一覧ではない。人間定義baselineとして使い、学習されたFactor候補と比較する。

### Residual

共有Factorで説明できないが、元経験の再構成や対象モダリティの予測に必要な情報。圧縮や共有のために破棄しない。

## 固定した境界ではなく適用可能性を持つ

Factorを`universal`か`specific`の二値へ早期分類しない。モダリティ、domain、身体条件、文化、時間粒度ごとの適用可能性と実測利得を持たせる。

```text
Factor F
├── language: predictive_gain, support, counterexamples
├── vision: predictive_gain, support, counterexamples
├── audio/music: predictive_gain, support, counterexamples
└── haptic: predictive_gain, support, counterexamples
```

複数モダリティで有効ならcross-modal候補、特定familyだけならsemi-shared候補、一つだけならmodality-specific候補として扱う。この所属は固定ラベルではなく、engine versionと評価結果に応じて更新可能にする。

## 共通構造と認める基準

軌跡の形やEmbeddingが似るだけでは不十分である。例えば、文章上の「緊張」と触覚の圧力上昇が同じ曲線を持っても、同じ意味や因果機構とは限らない。

最低条件:

```text
Source modalityで得たFactorをTarget modalityへbindingし、
Target固有の入力だけで学習したbaselineに対して、
held-out予測・制御・再構成のいずれかを改善し、
適用制約と失敗例を再現できること。
```

追加条件:

- 値の単位と型が一致または明示的に変換される
- 時間・順序alignmentの根拠がある
- 対象モダリティ固有のresidualを保持する
- 対応しないnegative pairで誤共有が増えない
- dataset ID、timestamp、labelなどの漏洩で対応付けていない
- paired dataを外した分割でも一部の転移が再現する
- 出典、元segment、Encoder／Decoder versionへ戻れる

## アーキテクチャ候補

```text
Language Encoder ─┐
Vision Encoder   ─┼→ typed Structure / Factor candidates
Audio Encoder    ─┤       + native residuals
Haptic Encoder   ─┘
                         ↓
               constrained structural reasoning
                         ↓
Language Decoder / Vision Decoder / Audio Decoder /
Haptic policy / action proposal
```

共通層を一つの密なEmbeddingだけへ限定しない。少なくとも次を比較する。

- shared contrastive Embedding
- 人間定義の状態・差分・順序・関係
- typed event graph / hypergraph
- Structural FactorizationとTransformation
- 自己組織化Unitから監査用Factorへの投影

専用Encoder／Decoderを維持し、中核のreasonerへ特定の基礎モデルを固定しない。

## クロスモーダル変換

文章の物語を音楽や触覚へ変換する処理は、意味の同一化ではなく、共有Factor候補を各モダリティの値へinstantiateする操作として扱う。

```text
Source observation
→ Source Structure
→ Factor sequence
→ Target binding constraints
→ Target-native realization proposal
```

例えば`stable → gradual deviation → abrupt transition → stable`を複数媒体へ描画できる。ただし、これは同じ抽象遷移を共有していることを示すだけで、生成物が同じ感情・意味を持つことまでは保証しない。

cycle consistencyや再構成成功だけでも十分ではない。情報を隠した退化表現や、表面的な同期で成功する可能性があるため、held-out予測、negative pair、因子ablationを併用する。

## 最初のtoy benchmark

同じ潜在状態遷移を、既知のRendererで4種類へ変換する合成データから始める。

```text
latent process:
  stable → increase → peak → abrupt decrease

renderers:
  language: 状態を記述する短文列
  vision: 物体位置・輝度・運動のanimation列
  audio/music: pitch・amplitude・rhythmの記号列
  haptic: pressure・vibrationのsimulated時系列
```

潜在状態、境界、順序、因子bindingを正解として保持できるため、単なる類似検索と構造回復を区別できる。実センサーや著作物を使う前に、分解・対応・転移評価の妥当性を確認する。

データ分割:

- held-out sequence
- held-out Factor composition
- held-out Renderer parameter
- held-out modality pair
- paired alignmentを減らしたweakly paired / unpaired条件
- 同じ表面軌跡だが意味・生成機構が異なるhard negative

## 評価指標

- native Structure抽出精度
- cross-modal Factor alignment precision / recall
- Target modalityでの予測利得
- held-out modality pairへの転移
- held-out Factor compositionの解決率
- modality-native再構成誤差
- residual保持率
- hard negative誤共有率
- alignmentずれへの頑健性
- Factor applicabilityの較正誤差
- 出典・segment・bindingの追跡率
- 1 observationあたりの抽出・検索・推論費用

比較baseline:

- 各モダリティ完全分離
- shared Embeddingのみ
- paired contrastive learning
- 人間定義Factor + 制約探索
- 学習Factor + 制約探索
- LLM／multimodal modelによる直接変換
- RISA Factor + modality-specific residual

## 失敗条件

- modality IDや収録条件だけを共有構造として学習する
- 時間同期だけで意味的対応を推定する
- すべてを一つの共通空間へ潰しnative情報を失う
- 共通Factorよりresidualが常に大きく、転移利得がない
- 表面曲線が似るだけで因果・意味が異なる例を統合する
- 共有によってTarget modality単独baselineより予測が悪化する
- 特定のpaired dataset内だけで成立し、別収集条件へ転移しない
- 音楽文化、身体差、sensor calibrationなどの文脈を失う
- Encoder更新後にFactor IDやbindingを追跡できない
- 共通化候補を検証済み事実へ自動昇格する

## 将来の保存モデル候補

toy benchmarkの前にmigrationを固定しない。効果確認後に次を候補とする。

```text
memory.modality_observations
  observation_uid, modality, asset_or_record_ref,
  time_range, native_schema, calibration, source_refs

memory.temporal_segments
  observation_id, segment_index, start, end,
  boundary_confidence, native_features_ref

memory.cross_modal_alignments
  source_segment_id, target_segment_id, alignment_type,
  offset, fit_score, evidence_refs, verification_state

memory.factor_modality_bindings
  factor_id, observation_or_segment_id, modality,
  variable_bindings, activation, residual_ref, fit_score

memory.factor_applicability_profiles
  factor_id, modality_or_domain, support_count,
  counterexample_count, predictive_gain, transfer_score,
  calibration_error, engine_version

memory.cross_modal_transfer_evaluations
  factor_id, source_modality, target_modality,
  task, baseline, metrics, dataset_version, engine_version
```

画像、音声、動画、触覚streamの本体はMinIO、構造化metadata、alignment、Factor binding、評価履歴はPostgreSQLを正本とする。

## 実装順序の依存関係

現在の`[Next]`であるSource・Record監査ログを優先する。この研究はAsset API、Event／Structure最小表現、時間segment、出典bindingが整ってから開始する。

```text
監査・Source・Asset基盤
→ Event / Structure / segment最小表現
→ synthetic multimodal renderer
→ modality別baseline
→ 人間定義Factorによるcross-modal transfer
→ 学習Factorとapplicability profile
→ hard negative・未対応pair評価
→ 実データ小規模試験
→ 効果確認後にMemory Schema確定
```

## 段階的な研究・実装予定

- [Done] Cross-modal Structural Abstractionを研究テーマとして採用
- [Later] 同じ潜在過程を文章・animation・音記号・触覚時系列へ描画するtoy dataset
- [Later] native value・modality-specific Structure・shared Factor候補・residualの最小表現
- [Later] modality別モデル、shared Embedding、人間定義Factorのbaseline比較
- [Later] held-out modality pairとheld-out compositionの転移評価
- [Later] Factorごとの連続的なapplicability profileと反例管理
- [Later] hard negative、alignmentずれ、dataset leakage耐性評価
- [Later] Structural Factorization・Transformation合成との接続
- [Later] baseline確認後に自己組織化UnitとSNN選択的活性化を比較
- [Later] 小規模な実映像・音・触覚sensor・文章データで再検証
- [Later] 有効性確認後にalignment・binding・transfer evaluationのMemory Schemaを確定

## 結論

RISAでは「文章・映像・音楽・触覚は同じ」と仮定しない。モダリティ固有値、固有構造、residualを保持したまま、別モダリティへ移したときにも予測・再構成・行動へ寄与する関係と変換だけをcross-modal Factor候補として扱う。

境界は固定した分類ではなく、**どのモダリティ・domainで、どの程度の予測利得と反例を持つか**という検証可能な適用可能性分布として表現する。
