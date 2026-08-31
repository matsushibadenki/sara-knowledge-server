# Training Runと評価履歴

## 目的

Training Runは、「どの不変Dataset Snapshotを、どのモデル、変換器、コード、seed、parameters、environmentで使用し、どの評価結果を得たか」を追跡する。

```text
Model Registry（変更可能）
        │ Run作成時に複製
        ▼
Training Run
├── model_snapshot（不変）
├── dataset_snapshot_id（不変データ参照）
├── transformer name / version / configuration
├── code_revision / seed / parameters / environment
├── lifecycle timestamps
└── append-only Metrics
```

English: A Training Run freezes the model definition and references an immutable Dataset Snapshot. It records the transformer, code revision, seed, parameters, environment, lifecycle, and append-only metrics required to reproduce and compare an experiment.

简体中文：Training Run 固定模型定义并引用不可变 Dataset Snapshot，同时记录转换器、代码版本、随机种子、参数、环境、生命周期以及只追加的评估指标。

## Schema

### `training.models`

再利用可能なModel Registry。name、provider、family、version、base model、configurationを保持する。Modelは変更可能なため、Runはこの行だけに再現性を依存しない。

### `training.runs`

Run作成時に以下を固定する。

- 所有者内で一意な`run_uid`
- `model_id`と作成時点の`model_snapshot`
- 完成済みかつ所有者が同じ`dataset_snapshot_id`
- `task_type`
- 変換器のname、version、configuration
- parameters、environment、code revision、seed
- output object key、error、開始・終了時刻

### `training.metrics`

Metricは追記のみとし、更新・削除APIを提供しない。同一Runの`metric_name + split + step`を一意にして、再送による二重記録を防ぐ。

splitは`train`、`validation`、`test`、`holdout`、`custom`を使用する。

## 状態遷移

```text
queued ──→ running ──→ completed
   │          ├──────→ failed
   │          └──────→ cancelled
   └────────────────→ cancelled
```

DB CHECK制約でtimestampとの整合性を保証し、APIは更新前statusを条件に含めて同時遷移を検出する。Metricは`running`または`completed`のRunにだけ追加できる。completed後の評価Metric追加を許可することで、学習処理と後続評価を同じRunへ結び付ける。

## API

```text
GET    /api/v1/training/models
POST   /api/v1/training/models
GET    /api/v1/training/models/:id
PATCH  /api/v1/training/models/:id

GET    /api/v1/training/runs
POST   /api/v1/training/runs
GET    /api/v1/training/runs/:id
POST   /api/v1/training/runs/:id/status
GET    /api/v1/training/runs/:id/metrics
POST   /api/v1/training/runs/:id/metrics
```

読み取りは`training:read`、変更は`training:write` scopeを要求する。現在はすべて所有者境界内で扱う。

## 現在の範囲

- [Done] Model Registry
- [Done] 完成済みSnapshotを参照するTraining Run
- [Done] Model Snapshot、変換器Version、code revision、seed、設定の固定
- [Done] guarded lifecycle transition
- [Done] append-only Metricと重複防止
- [Done] role、scope、owner境界
- [Done] Event・Experience・Entity・Concept・Relationの最小Memory Schema
- [Done] Relation Evidence・Entity Alias・候補検証フロー
- [Next] Bulk Event ingestion・bounded graph traversal
- [Later] checkpoint／artifact詳細、Run比較API、外部trainer callback署名
