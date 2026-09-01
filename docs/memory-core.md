# Memory Core

## 目的

Memory Coreは、観測、経験、実体、概念、関係を、出典・時間・候補生成元・検証状態を失わずに保存するKnowledge Serverの中核である。

```text
Source / Record / Dataset Snapshot / Model
                    │
                    ▼
Experience ── contains ── Event
     │                       │
     └──── Entity / Concept ─┘
                   │
                   ▼
             typed Relation
```

English: Memory Core stores Events, Experiences, Entities, Concepts, and typed Relations while preserving provenance, time, confidence, proposal source, and verification state.

简体中文：Memory Core 保存事件、经验、实体、概念和类型化关系，同时保留来源、时间、置信度、候选生成来源及验证状态。

## 実装テーブル

### `memory.experiences`

複数Eventをまとめる経験単位。状態変化、reward、prediction error、品質、curriculum level、split、Sourceを保持する。

### `memory.events`

時間順序を持つ観測単位。modality、event type、symbol、state before／after、reward、prediction error、confidence、quality、novelty、extractor、Source、Experienceを保持する。

### `memory.entities`

世界内の人物、場所、物体、組織、モデルなどの実体候補。canonical name、type、properties、confidence、Sourceを保持する。

### `memory.concepts`

抽象概念または名前のないパターン候補。labelは任意とし、concept type、evidence count、contradiction count、event pattern、utility、Sourceを保持する。

### `memory.relations`

以下のnode type間を結ぶ多型Relationである。

```text
event
experience
entity
concept
record
dataset_snapshot
model
```

Relationはtype、strength、confidence、evidence／counterexample count、時間差、validity、context、proposal source、verification stateを保持する。

## 候補と検証状態

```text
unverified
candidate
verified
rejected
```

LLM、rule、RISAなどが生成した内容は原則として`unverified`または`candidate`で保存する。再現性や頻度だけを真実とみなさず、人間・独立資料・ルール等で確認したものだけを`verified`へ変更する。

## 整合性

- 全Memory行を作成者境界内で扱う。
- UIDは作成者内で一意にする。
- Source参照は論理削除されていない所有Sourceだけを許可する。
- EventのExperience参照は有効な所有Experienceだけを許可する。
- Relationの両端はサービス層でnode type、存在、所有者、論理削除状態を検証する。
- Dataset Snapshot nodeは`completed`のみRelationへ利用できる。
- 削除は論理削除とし、通常の取得・一覧・neighbor検索から除外する。
- 有効RelationまたはEventから参照されているMemory nodeの削除は拒否し、dangling edgeを防ぐ。
- probability、count、duration、delay、validity rangeはAPIとDB CHECKの両方で検証する。
- Relationのsource／target検索には有効行だけの部分複合索引を使用する。

多型RelationはPostgreSQLの通常FKだけでは参照先を完全保証できない。現段階ではサービス層検証を必須とし、将来の運用データを見て型別edge tableへの分割を再評価する。

## API

各resourceは一覧、作成、取得、部分更新、論理削除を提供する。

```text
/api/v1/memory/experiences
/api/v1/memory/events
/api/v1/memory/entities
/api/v1/memory/concepts
/api/v1/memory/relations

GET /api/v1/memory/nodes/:type/:id/neighbors
```

読み取りは`memory:read`、変更は`memory:write` scopeを要求する。

## 次の実装

- [Done] Event・Experience・Entity・Concept・Relationの最小Schema
- [Done] CRUD、provenance、owner境界、論理削除
- [Done] 多型Relation参照検証とneighbor検索
- [Done] candidate／verifiedの分離
- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Done] Bulk Event ingestion・bounded graph traversal
- [Done] SARA／external Worker HTTPS ingestion・HMAC署名・replay protection
- [Done] Queue-backed asynchronous Event ingestion for 501〜10,000 events
- [Done] Asset API・upload authorization・provenance binding
- [Next] Asset processing jobs・derived-Asset provenance
- [Later] bulk Event、traverse、embedding、activation、Replay
