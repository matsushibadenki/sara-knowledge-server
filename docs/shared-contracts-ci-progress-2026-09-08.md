# API／Worker共有契約・CI 実装記録

## 実装結果

- [Done] `packages/domain-contracts` workspace packageを追加。
- [Done] Eventの単体／Bulk／非同期入力schemaとDB値変換をAPIとWorkerで共有。
- [Done] JSON、JSONL、CSVのImport解析、行数上限、Record正規化、draft限定、score範囲検証を同期APIと非同期Workerで共有。
- [Done] API／Worker Docker imageへ共有packageを同じlockfileから組み込む。
- [Done] GitHub Actionsでlockfile install、unit／contract test、API／Worker build、空DB migration、実Worker統合試験を一つのjobとして定義。
- [Done] 空の一時DBへ25 migrationを適用し、5 schema内の36 application tableを確認。

English: The API and Worker now consume the same Event and Record import contracts. CI builds both images, migrates an empty PostgreSQL database, and runs the integration suite with the real Worker.

简体中文：API 与 Worker 现在使用相同的 Event 和 Record 导入契约。CI 会构建两个镜像、迁移空的 PostgreSQL 数据库，并使用真实 Worker 运行集成测试。

## 検証

- `bun test`: 17 pass、1 integration skip、0 fail、39 assertions
- `docker compose exec -T -e RUN_INTEGRATION=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test`: 14 pass、0 fail、402 assertions
- APIはhealthy、Workerは共有packageを読み込んで起動し、501件Eventと非同期Importの実処理を完了。
- `docker compose config --quiet`とCI workflow YAML parse成功。

## 残る作業

- [Next] 1,600行超の統合ケースを責務別ファイルへ分割し、fixture生成とcleanupを共通化する。
- [Later] G0.4でJob lease、heartbeat、claim generation、retry／reaperを実装し、Redis停止や旧claim遅延完了をCIで試験する。
