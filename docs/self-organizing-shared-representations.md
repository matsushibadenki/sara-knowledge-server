# 自己組織化する共有表現

## 設計判断

この考え方を、RISAが人間定義のKnowledge Graphへ固定されることを防ぐ中心的な研究原則として採用する。

```text
分類してから共有する
ではなく
局所表現を再利用した結果として、共有構造と概念候補が現れる
```

RISAにおける概念候補を、人間が先に定義した分類だけではなく、複数の経験で繰り返し活性化・再利用される内部構造として扱う。

```text
Concept candidate
≈ 複数の経験・文脈で反復利用され、
  圧縮、予測、転移のいずれかに寄与する共有表現
```

ただし、反復利用されたものが必ず意味のある概念になるとは限らない。撮影環境、データ形式、話者、収集元などの交絡も共有され得るため、安定性、予測利得、別データへの転移、反例によって評価する。

## 二つの表現層

自己組織化と監査可能性を両立するため、表現を二層に分ける。

```text
学習・活性層
経験 → 再利用可能な局所Unit → Assembly → 高次Assembly
      名前なし、重なり可、継続的に再編成

監査・交換層
Experience / Structure / Delta / Transformation
      不変snapshot、出典、反例、検証、取消が可能
```

学習・活性層では、同じ局所Unitを複数経験が参照することで重なりを形成する。監査・交換層では、その時点の共有状態から明示的なStructure、差分、変換候補を生成し、再現可能な形で保存する。

暗黙共有を唯一の正本にはしない。元のRecord、Event、Asset、出典、不変snapshotを失わない。

## 基本表現

具体経験を、単一の完成グラフだけでなく、疎な共有Unitと残差の組として表現できるようにする。

```text
Experience A = {P1, P7, P13} + residual A
Experience B = {P1, P7, P92} + residual B

shared(A, B) = {P1, P7}
specific(A)   = {P13} + residual A
specific(B)   = {P92} + residual B
```

Unitは、人間語彙で命名されたrelationに限定しない。

- 局所的な役割構造
- 時間間隔や順序
- 空間配置
- 状態遷移
- 因果候補
- 複数modalityの共起
- 埋め込みまたはSNNの時空間活動パターン
- 他Unitの組合せ

Unitには安定した内部IDを与え、言語ラベルは任意の後付け属性とする。`latent-3817`が有用なら、人間が意味を説明できない状態でも候補として保持できる。

## 自己組織化の処理仮説

新しい経験ごとに全既存グラフとの同型判定を行わない。局所的な再利用と競合で共有表現を形成する。

```text
1. 入力を局所fragment・時間窓・役割候補へ分解
2. content address、型、近傍、活動状態から再利用候補を取得
3. 候補Unitを活性化し、top-kまたは疎な競合で割り当て
4. 説明できない部分だけ新規Unitまたはresidualにする
5. 共活性、時間的近接、予測成功に応じて結合を更新
6. 反復するUnit集合を上位Assembly候補にする
7. Assemblyから次状態・欠損関係・関連経験を予測
8. 安定性と有用性を満たした候補をconsolidate
9. 必要な候補だけ人間または外部モデルが命名
```

「概念生成を命令する分類アルゴリズム」は置かないが、Unitの割当、競合、生成、統合、分裂、休眠、忘却を制御する学習則は必要である。自己組織化という言葉でアルゴリズム設計を省略しない。

## 再帰的な高次構造

Unitは別のUnitを構成要素にできる。

```text
Experience
└── local Unit P
    └── Assembly Q
        └── higher-order Assembly R
```

階層の深さを人間が固定しない一方、無制限に増殖させない。

- 最小支持数
- 新しい予測利得
- 記述長の改善
- 複数文脈での再利用
- 時間経過後の安定性
- 親Unitとの冗長性
- 計算・保存コスト

これらを用いて生成、維持、統合、休眠を判断する。

## Deltaとの関係

共有参照から差分を自然に導出できる。

```text
A ∩ B = 共有Unit
A - B = A固有Unitとresidual
B - A = B固有Unitとresidual
```

ただし、これだけでは「誤りの訂正」「文脈限定」「例外追加」「時間順序変更」などの意味を監査できない。したがって型付きDeltaは廃止せず、次の用途に限定して併存させる。

- Structureの版変更
- 人間またはルールによる編集
- 共有状態の二時点比較
- 変換候補の説明
- 再構成、取消、監査

自己組織化Unitは学習の内部表現、型付きDeltaは検証可能な派生・交換表現である。

## 名前のない構造を知識候補とみなす条件

人間が理解または命名できないだけで、そのUnitを破棄しない。ただし頻出だけでは知識と断定しない。

最低でも次の一つ以上へ再現可能に寄与し、交絡検査を通過する必要がある。

- 次状態または欠損関係の予測
- 別領域・別時期・別modalityへの転移
- 経験の圧縮と決定的再構成
- 検索または異常検知
- 行動選択や予測誤差の改善

名前のないUnitの表示名は、意味を推測した名称ではなく`latent-{uid}`とする。説明候補、代表事例、反例、予測先、活性文脈を別属性で保持する。

## 将来のデータモデル候補

### `memory.representation_units`

```text
unit_uid
unit_kind
level
representation
content_hash
status
confidence
proposal_source
engine_version
created_at
```

### `memory.experience_unit_bindings`

```text
experience_type
experience_id
unit_id
role
activation
binding_strength
temporal_offset
spatial_context
residual_ref
evidence_refs
```

### `memory.unit_compositions`

```text
parent_unit_id
child_unit_id
composition_role
position_or_order
weight
context
```

### `memory.unit_statistics`

```text
unit_id
usage_count
distinct_context_count
predictive_gain
compression_gain
transfer_score
stability_score
last_activated_at
```

### `memory.unit_labels`

```text
unit_id
language_code
label
description
label_source
verification_state
```

これらは実装済みテーブルではない。Unitの表現方式がtoy experimentで有効と確認されるまで、DBスキーマを固定しない。

## Knowledge ServerとRISAの責務

```text
RISA / SARA Engine
= fragment化、Unit割当、疎な競合、共活性更新、
  Assembly形成、予測、分裂・統合・休眠の提案

SARA Knowledge Server
= 元経験、Unit snapshot、binding、統計、ラベル、
  出典、生成エンジン、検証状態、監査履歴の正本
```

SNNとの接続では、似た時空間活動が同じ回路またはUnitを再利用する方式を研究候補とする。ただし、それが脳の実際の学習機構であるとは断定せず、計算モデルとして比較評価する。

## 評価

比較対象:

```text
人間定義relationのみ
明示的graph matchingとpattern抽出
Embedding clustering
自己組織化Unit再利用
自己組織化Unit + 監査用Structure/Delta
```

評価指標:

- Unitの経験間再利用率
- 予測利得とheld-out精度
- データ分割、時期、modality変更後の安定性
- 人間ラベルを与えない状態での転移性能
- latent Unitから得られる新規性
- 代表事例と反例の追跡率
- Structureへの投影・再構成成功率
- Unitの過剰分裂率と過剰統合率
- 休眠後の再活性化精度
- 1経験あたりの探索・更新コスト

## 失敗条件

- 人間定義ontologyの言い換えに留まる
- 全経験との総当たり比較が必要になる
- 収集元、背景、形式などの交絡だけを学習する
- すべてが一つのUnitへ潰れるrepresentation collapse
- ほぼ全経験が固有Unitになる過剰分裂
- Unit IDや構成が更新ごとに不安定で追跡できない
- 元経験、出典、反例へ戻れない
- 名前のない頻出パターンを無条件に知識とみなす
- 明示的pattern方式やEmbedding方式より予測・コストが改善しない

## 実装段階

- [Next] Source APIで元経験と出典を先に追跡可能にする
- [Later] 小規模なイベント列用Unit表現をインメモリで試す
- [Later] top-k再利用、新規Unit生成、residual保持を実装する
- [Later] 共活性から二階層Assemblyを形成するtoy experimentを行う
- [Later] latent Unitによるheld-out予測と交絡耐性を評価する
- [Later] 有効性確認後にMemory Schemaと監査用Deltaへ接続する

## 結論

RISAでは、人間が構造を先に発見して分類することを前提にしない。経験が同じ内部資源を部分的に再利用し、その重なりが安定して予測・圧縮・転移へ寄与したとき、後から構造または概念候補として観測される設計を目指す。

```text
Knowledge
= 経験空間に自己組織化された再利用可能な構造体系
+ その根拠、反例、履歴を検証できる外部記憶
```
