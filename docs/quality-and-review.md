# 品質管理とレビュー

## 目的

Recordを単に保存するだけでなく、再利用可能なタグ、版に結び付いた注釈、追記型の評価、人間または認可APIによるレビュー履歴を保持する。

> **English:** Tags are reusable labels, while annotations, evaluations, and reviews are bound to the exact Record Version they describe. Pending reviews lock the Record against updates and deletion.
>
> **简体中文：** 标签是可复用的标记；注释、评估和审核均绑定到其所描述的精确记录版本。审核待处理期间禁止修改或删除该记录。

## データモデル

- `dataset.tags`: NFKC・空白整理・小文字化した名前で重複を防ぐ共有タグ
- `dataset.record_tags`: RecordとTagの多対多関連
- `dataset.annotations`: comment、correction、label、entity、relationの構造化注釈
- `dataset.evaluations`: metric、0〜1のscore、pass／fail／needs_reviewを持つ追記型評価
- `dataset.record_reviews`: 申請Version、申請者、判定者、判定履歴

Annotation、Evaluation、Reviewは`record_id`だけでなく`record_version_id`も保存する。Record更新後も、どの内容への判断だったかを失わない。

## レビュー状態遷移

```text
draft / rejected / approved
        │ submit-review
        ▼
pending_review
   ├── approved          → Record: approved
   ├── rejected          → Record: rejected
   └── changes_requested → Record: draft
```

pending中はRecord更新と論理削除を409で拒否する。Review判定時にもRecordとReviewを行ロックし、申請Versionと現在Versionが異なる場合は判定しない。pending ReviewはRecordごとに1件だけで、DB部分一意索引でも保証する。

## 権限

- 閲覧: `records:read`、admin／editor／reviewer／viewer
- Tag付与・Annotation・Evaluation・申請: `records:write`
- Review Queue・判定: `records:approve`、admin／reviewer
- APIキーは対応scopeを明示的に持つ場合のみ利用できる

## API

```text
GET/POST   /api/v1/records/:id/tags
DELETE     /api/v1/records/:id/tags/:tagId
GET/POST   /api/v1/records/:id/annotations
POST       /api/v1/records/:id/annotations/:annotationId/resolve
GET/POST   /api/v1/records/:id/evaluations
POST       /api/v1/records/:id/submit-review
GET        /api/v1/records/:id/reviews
POST       /api/v1/records/:id/reviews/:reviewId/decision
GET        /api/v1/review-queue
```

Reviewの申請と判定はRecord状態変更と同じトランザクションで監査される。監査actionは`submit_review`、`approve`、`reject`、`request_changes`を使用する。

## 現在の境界

- EvaluationからRecordの`quality_score`を自動集約しない
- AnnotationとEvaluationは物理削除・上書きAPIを持たない
- Tag辞書の統合・別名管理は未実装
- 複数レビュアーの合議、review assignment、SLAは未実装
- 次工程はJSONL／JSON／CSVの一括取り込み・出力
