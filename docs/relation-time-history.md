# Relationの時間履歴 / Relation time history / 关系时间历史

🟢 [Done] `GET /api/v1/memory/relations/:id/revisions` は、各版の記録時刻 `recorded_at` と、その版が主張する有効期間 `snapshot.valid_from`・`snapshot.valid_until` を返す。`limit` と `before_revision` で過去にさかのぼれる。訂正は後続版として記録し、`supersedes_revision` で直前版を示す。既存の論理DELETEは撤回版として残り、通常のGraph検索から除外される。各版は `context` と反証件数を保持する。

移行前のRelationは、当時の変更履歴を推測せず移行時点の状態を `migration_baseline` として一件保存する。記録時刻はDBでスナップショットを作成した時点。履歴は既存のMemory読取権限で閲覧できる。マイグレーション0031はAPI更新・Evidence登録・Verification・論理DELETEのすべてを同じDBトランザクション内で記録する。

English. Relation history separates database recording time from the validity interval asserted by each revision. Corrections point to their predecessor and soft deletion records a retraction. Legacy relations start at a migration baseline. Context and counterexample counts travel with each revision.

简体中文。关系历史区分数据库记录时间与每个版本声明的有效期。更正指向前一版本，软删除留下撤回版本。旧关系从迁移基线开始记录，每个版本保留语境和反例数量。

🟠 [Next] 古いEvidenceを自動で失効させ、再検証へつなぐ。矛盾の自動検出や、文脈の同一性判定は別途必要。
