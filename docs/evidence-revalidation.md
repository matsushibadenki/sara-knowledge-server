# 出典変更とEvidence再検証 / Source evidence revalidation / 来源证据复核

🟢 [Done] Sourceの版が変わると同じDBトランザクションで再検証ジョブを登録する。登録済みEvidenceの出典版が現行版と異なる場合は `source_revised`、出典が論理削除されていれば `source_withdrawn` を返す。Graph探索は処理待ちでも該当Relationを除外する。移行時にすでに失効している参照もキューに追加する。

- `GET /api/v1/memory/stale-evidence?source_id=…` で影響を受けたEvidenceとRelationを一覧化する。カーソルは `after_id`。
- `GET /api/v1/memory/evidence-revalidation?source_id=…` で出典版ごとのジョブを照会する。状態は `queued`、`no_impact`、`needs_review`。
- WorkerはPostgreSQLで排他的に取得し、影響件数の確定と、検証済み・却下済みのRelationを候補に戻す更新を一括で確定する。停止でSQLがロールバックされた場合、次のWorkerが処理を引き継ぐ。

対象はSource版を固定したEvidence。出典不明の旧データに履歴を補完しない。根拠の妥当性は自動承認しない。差し替えと再レビューの手順は以下に記載。

English. A source revision atomically queues a durable job. Graph traversal excludes affected relations immediately. The worker counts affected evidence and returns previously decided relations to candidate status. The replacement and review workflow is described below.

简体中文。来源版本变更与复核任务在同一事务中保存。图遍历立即排除受影响的关系。Worker统计受影响的证据，并将已有审核结论的关系降为候选。替换与复核流程见下文。

🟢 [Done] `POST /api/v1/memory/relations/:id/evidence` accepts `supersedes_evidence_id` together with the existing required Relation revision. The predecessor must be active stale evidence on the same Relation. The replacement must pin a current Source revision. The predecessor remains in history with `replaced: true`. Active counts and stale checks use the replacement. The existing verification API refuses a final decision while active stale evidence remains. A completed decision records the reviewer and the reviewed evidence IDs, pins and replacement links.

`GET /api/v1/memory/source-impact?source_id=…&kind=relation|snapshot|training_run` lists historical Relation evidence links, or follows pinned Record Versions to Snapshot members and Training Runs. Results are paginated by `after_id` and require read scopes for all four resource families. This traces stored references, including past use. Impact results do not change historical snapshots or runs. The source job retains the outcome of its automated check. The per-Relation verification decision records human review completion.

日本語。差し替えは旧Evidenceを履歴に残し、現行出典版を固定した新Evidenceを有効にします。未差し替えの失効根拠が残ると最終レビューは確定できません。再レビューの判断には確認済みEvidenceと版を保存します。影響一覧は保存済み参照に基づいてRelation、Snapshot、Training Runを返します。

简体中文。替换时保留旧证据，并启用固定到当前来源版本的新证据。仍有失效证据时无法完成审核。审核决策记录已复核的证据及版本。影响查询基于已保存的引用追踪关系、快照和训练运行。

検証。隔離PostgreSQL・Redis・MinIO・実Workerで全migrationとMemory graph／Dataset Trainingの統合試験を実行し、2件・170 assertionsが成功。
