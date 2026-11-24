# 版固定チャンクと併用検索 / Versioned chunks and hybrid search / 版本化分块与混合检索

🟢 [Done] `PUT /api/v1/search/records/:id/versions/:versionId/index` でRecord Versionを明示して索引登録する。Recordの読取・書込権限が必要。チャンクはRecord Version ID、Encoder名、チャンク番号で固定し、再登録で重複しない。入力は題名・プレーンテキスト・JSON本文で、最大32,768文字。現行方式 `char-ngram-hash/1` はNFKC正規化後の文字n-gramを256次元へ変換する。外部モデルは不要。

`GET /api/v1/search/hybrid?q=…&mode=candidate|confirmed&limit=…` はRecordに対して、字句一致を優先し、pgvectorの最大コサイン類似度で順位付けする。字句一致または類似度0.5以上が対象。両指標を返すため、既存の字句検索と比較できる。未登録のRecordでも字句一致なら取得可能。現行Record Versionだけを利用し、確定モードでは出典の版と撤回状態を照会時に判定する。ベクトルは厳密比較を使用し、SQLは3秒で打ち切る。

隔離DBで全migration、重複登録、類似度を含む結果、出典訂正直後の除外を確認した。実コーパスでの品質・遅延の比較、索引の自動生成、学習済みEncoderは今後の評価対象。

English. The index binds chunks to a Record Version and encoder. Hybrid Record search reports the literal match and exact pgvector cosine similarity. Confirmed search rechecks provenance at query time. Indexing is explicit and the hash encoder is a comparison baseline.

简体中文。分块绑定记录版本及编码器。混合检索返回字面匹配及 pgvector 精确余弦相似度，已确认模式在查询时复核来源。索引需显式生成，哈希编码器用于基线比较。
