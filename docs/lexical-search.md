# 三言語字句検索 / Multilingual lexical search / 三语字面检索

🟢 [Done] `GET /api/v1/search?q=再起動&mode=confirmed` はRecordとRelationのID・版・状態を返す。RecordとMemoryの読取権限が必要。`kind=record|relation` で対象を限定できる。`limit` と `cursor` でページ送りし、カーソルは検索条件に結び付く。

日本語・英語・简体中文をNFKC正規化し、大文字と小文字を区別せず、空白で区切った語のAND部分一致を取る。検索対象はRecord Versionの題名・プレーンテキスト・本文、Relationの種別・文脈・内容。PostgreSQLのGINトライグラム索引を追加した。形態素解析、語幹処理、翻訳、関連度順は別途評価する。

- `candidate` は下書き・レビュー待ちのRecordと候補・未検証のRelationを返す。
- `confirmed` は承認済みRecordと、現在有効で検証済みのRelationに限定する。出典付きRecordは現行の出典版へ固定されている必要がある。Relationは有効な出典で裏付けられ、差し替え済みEvidenceを除くすべての根拠で出典を確認できる必要がある。訂正・撤回された出典や古いRecord版を含む結果は検索時に除外する。出典を確認できない旧Evidenceも確定結果から除外する。

隔離PostgreSQLで全migrationを適用し、Workerを起動せずに統合試験を実行した。三言語、全角英字、ワイルドカードのリテラル扱い、カーソル、承認済みRecordと検証済みRelationの訂正時除外、差し替え・再レビュー、撤回時除外を確認した（25アサーション）。

English. Literal search supports Japanese, English and Simplified Chinese with NFKC normalization, case-insensitive matching and cursor pagination. Confirmed mode checks current source and evidence at query time. A corrected or withdrawn source can remove a result immediately, before worker processing.

简体中文。字面检索支持日语、英语和简体中文，执行 NFKC 归一化、不区分大小写，并提供游标分页。已确认模式在查询时核对来源和证据版本，来源订正或撤回后立即排除受影响结果。
