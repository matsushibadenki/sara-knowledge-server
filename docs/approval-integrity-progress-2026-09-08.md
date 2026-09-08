# Approval integrity progress — 2026-09-08

## 実装

- [Done] 一般Record POST／PATCHが`draft`以外のworkflow状態を直接作れないようにした
- [Done] 承認済みRecordの更新は新Versionを作成し、親Recordを`draft`へ戻す
- [Done] 承認済みReviewは判定対象の旧`record_version_id`へ固定して保持する
- [Done] JSON／JSONL／CSV同期Importで`draft`以外の行を失敗として記録する
- [Done] 非同期Import Workerにも同じ`draft`制約を適用する
- [Next] Memory resourceへrevision番号と楽観的競合制御を追加し、Verification Decisionを対象revisionへ固定する

## 検証

- `bun test`: 13 pass、1 integration skip、0 fail、28 assertions
- `docker compose exec -T -e RUN_INTEGRATION=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test`: 14 pass、0 fail、389 assertions
- 直接approved作成、直接approved PATCH、承認後の内容更新、同期Import、実Workerによる非同期Importを回帰試験で確認

## English

General Record writes and both import paths can now create drafts only. Editing an approved Record creates a new draft version while the approval remains bound to the previously reviewed version. The Docker integration suite exercises the real asynchronous worker.

## 简体中文

普通记录写入以及同步、异步导入现在只能创建草稿。修改已批准记录时会创建新的草稿版本，原批准记录仍绑定到先前审核的版本。Docker集成测试已覆盖真实异步Worker。
