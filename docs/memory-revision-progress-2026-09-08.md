# Memory revision・Verification snapshot 実装記録

## 実装結果

- [Done] Experience、Event、Entity、Entity Alias、Concept、Relationへ1始まりの`revision`とDB CHECKを追加。
- [Done] Memory PATCHへ`expected_revision`を必須化し、revision一致を更新条件に含めた楽観的競合制御を追加。
- [Done] Relation Evidence追加も対象Relationの`expected_revision`を要求し、Evidence、count、revisionを同一transactionで更新。
- [Done] verified／rejectedのMemory内容を変更した場合にcandidateへ戻す。
- [Done] Verificationでもstateとrevisionを同時に照合し、更新後revisionと完全な内容snapshotをDecisionへ保存。
- [Done] 同じrevisionからの同時PATCHは1件だけ成功し、他方が`REVISION_CONFLICT`になる統合試験を追加。
- [Done] 承認後の編集でcandidateへ戻り、過去Decisionのsnapshotが承認時の内容を保持する試験を追加。

English: Memory writes now use optimistic revisions. A verification decision stores the exact post-decision revision and content snapshot, and later edits return verified or rejected content to candidate.

简体中文：Memory 写入现在使用乐观修订控制。验证决定保存决定后的准确修订号和内容快照；之后编辑已验证或已拒绝的内容时，会回到候选状态。

## Migrationと検証

- Migration: `0024_aspiring_skreet.sql`
- 変更前backup: PostgreSQL container内 `/tmp/sara-before-memory-revisions.dump`
- Backupを一時DBへ復元し、全migrationを再適用。既存Conceptのrevisionが1であり、既存Decisionのrevision／snapshotがNULLにならないことを確認後、一時DBを削除。
- `bun test`: 13 pass、1 integration skip、0 fail、28 assertions
- `docker compose exec -T -e RUN_INTEGRATION=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test`: 14 pass、0 fail、402 assertions

## 既知の境界

- Migration前のDecisionは当時の対象内容を復元できないため、`target_revision = 1`、`target_snapshot = {}`で移行する。推測による履歴生成は行わない。
- Relation Evidence自身が参照先の内容revisionを固定する機能、Source revision、訂正伝播、stale依存先の再検証JobはG1で扱う。
- Alias削除を含む論理削除操作のrevision競合制御は未実装。今回の契約は内容PATCH、Evidence追加、Verificationを対象とする。

## 次工程

- [Next] G0.3: APIとWorkerで重複するdomain service／入力schemaを共有し、統合試験とmigration試験を責務別に分割する。
- [Later] G0.4: Job lease／heartbeat／claim generation／reaperを実装する。
