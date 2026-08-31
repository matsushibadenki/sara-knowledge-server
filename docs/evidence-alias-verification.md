# Relation Evidence・Entity Alias・候補検証

## 目的

Memory CoreのRelation、Entity、Concept、Eventを、単なる編集可能な行ではなく、証拠、別名、検証判断の履歴を持つ知識候補として管理する。

```text
Observation / Source / Record
              │
              ▼
       Relation Evidence
        ├── supports
        └── counterexample
              │
              ▼
        Relation counts

candidate ── reviewer decision ──→ verified / rejected
                  │
                  └── immutable decision history
```

English: Relation Evidence is append-only and updates support or counterexample counts atomically. Entity aliases are normalized for deduplication. Verification state changes require guarded reviewer decisions and retain immutable history.

简体中文：关系证据仅追加，并以事务方式更新支持或反例计数。实体别名经过标准化去重。验证状态只能通过带预期状态的审核决定修改，并保留不可变历史。

## Relation Evidence

`memory.relation_evidence`は次を保持する。

- relation内で一意な`evidence_uid`
- evidence type
- reference typeとreference ID
- support／counterexample
- weight
- details
- creatorとtimestamp

内部参照はSource、Record、Event、Experience、Entity、Concept、Dataset Snapshot、Modelを検証する。`external`はUUIDを持たず、URLや資料情報を`details`へ保存する。

Evidence追加とRelationの`evidence_count`または`counterexample_count`更新は、短い同一DBトランザクションで行う。Evidenceの更新・削除APIは提供しない。重複UIDではトランザクション全体がrollbackされ、countだけ増えることはない。

現段階ではEvidence追加時にconfidenceを自動計算しない。weight、独立Source数、反例、文脈多様性を含むcalibration方式を評価してから導入する。

## Entity Alias

Aliasは次の正規化を行う。

```text
Unicode NFKC
前後空白除去
連続空白を1文字へ統合
小文字化
language code小文字化
```

Entity、language、normalized aliasの組を有効行内で一意にする。人間が付けたAliasとAI生成Aliasを区別するため、proposal source、confidence、verification stateを保持する。

## 候補検証フロー

検証対象:

```text
event
entity
entity_alias
concept
relation
```

作成時に指定できる状態は`unverified`または`candidate`だけとする。通常PATCHから`verification_state`を除外し、未知・禁止fieldをstrict validationで拒否する。

状態遷移:

```text
unverified → candidate / verified / rejected
candidate  → verified / rejected
verified   → candidate
rejected   → candidate
```

検証APIは`memory:verify` scopeとadmin／reviewer roleを要求する。リクエストに`expected_state`を含め、対象更新と`memory.verification_decisions`への履歴追加を同一トランザクションで行う。

## API

```text
GET    /api/v1/memory/entities/:id/aliases
POST   /api/v1/memory/entities/:id/aliases
DELETE /api/v1/memory/entities/:entityId/aliases/:aliasId

GET  /api/v1/memory/relations/:id/evidence
POST /api/v1/memory/relations/:id/evidence

GET  /api/v1/memory/verification/:type/:id
POST /api/v1/memory/verification/:type/:id
```

## 次の実装

- [Done] append-only Relation Evidence
- [Done] support／counterexample countの原子的更新
- [Done] Entity Alias正規化・重複防止
- [Done] guarded verification transitionとDecision履歴
- [Done] verification stateの直接PATCH禁止
- [Done] Bulk Event ingestion・bounded graph traversal
- [Done] SARA／external Worker HTTPS ingestion・HMAC署名・replay protection
- [Next] Queue-backed asynchronous Event ingestion for batches over 500
- [Later] confidence calibration、独立Source集計、合議レビュー
