# Evidence参照版 / Evidence reference pins / 证据引用版本

🟢 [Done] Evidence登録とRelation更新を同じトランザクションで行い、登録時にSource revisionまたはRecord Versionを固定する。他の内部参照は登録時の状態をDB内に保存する。既存行の参照版は不明として `reference_pin: null` を返す。

Evidence一覧は同じSource IDをまとめ、内容hashが一致するEvidenceを別途表示する。別IDやhashの違いだけで出典の独立性は認定しない。出典を確認できないEvidenceは別に数え、既存の賛成・反証数は従来どおり登録件数を表す。

隔離PostgreSQLへの全migrationとMemory graph統合試験を実行。Source／Record訂正後の旧参照保持、新規参照の新版固定、同一Sourceの集約を確認した。

English. Registration pins Source and Record versions and preserves other internal targets as snapshots. Lists group shared source IDs and matching content hashes. These groups do not establish independent corroboration. Legacy pins remain unknown.

简体中文。登记时固定来源与记录版本，并在库内保存其他内部目标的快照。列表按相同来源ID分组，并另列内容哈希相同的证据。分组不代表独立佐证，旧证据的引用版本保留为未知。
