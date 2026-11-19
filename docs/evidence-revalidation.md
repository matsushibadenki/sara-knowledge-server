# 出典変更とEvidence再検証 / Source evidence revalidation / 来源证据复核

🟢 [Done] Sourceの版が変わると同じDBトランザクションで再検証ジョブを登録する。登録済みEvidenceの出典版が現行版と異なる場合は `source_revised`、出典が論理削除されていれば `source_withdrawn` を返す。Graph探索は処理待ちでも該当Relationを除外する。移行時にすでに失効している参照もキューに追加する。

- `GET /api/v1/memory/stale-evidence?source_id=…` で影響を受けたEvidenceとRelationを一覧化する。カーソルは `after_id`。
- `GET /api/v1/memory/evidence-revalidation?source_id=…` で出典版ごとのジョブを照会する。状態は `queued`、`no_impact`、`needs_review`。
- WorkerはPostgreSQLで排他的に取得し、影響件数の確定と、検証済み・却下済みのRelationを候補に戻す更新を一括で確定する。停止でSQLがロールバックされた場合、次のWorkerが処理を引き継ぐ。

対象はSource版を固定したEvidence。出典不明の旧データに履歴を補完しない。根拠の妥当性は自動承認しない。失効したEvidenceの差し替えと再レビュー完了の記録は後続項目。

English. A source revision atomically queues a durable job. Graph traversal excludes affected relations immediately. The worker counts affected evidence and returns previously decided relations to candidate status. Replacing stale evidence and recording review completion remain follow-up work.

简体中文。来源版本变更与复核任务在同一事务中保存。图遍历立即排除受影响的关系。Worker统计受影响的证据，并将已有审核结论的关系降为候选。替换失效证据及记录人工复核完成属于后续工作。
