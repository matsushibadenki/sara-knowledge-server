# Source API・出典登録フロー 実装記録 2026-08-21

## 実装結果

- [Done] Source一覧・作成・詳細・更新・論理削除・復元API
- [Done] `source_type`、検索語、ページングによる一覧取得
- [Done] `sources:read`と`sources:write`によるAPIキーscope認可
- [Done] JWTユーザーのrole認可
- [Done] Record作成・更新時の有効Source検証
- [Done] 無効または論理削除済みSourceに対する`404 SOURCE_NOT_FOUND`
- [Done] Record詳細からSource情報を追跡できるレスポンス
- [Done] Source論理削除後も既存Recordのprovenanceを保持
- [Done] Source種別のDB CHECK制約
- [Done] Sourceの更新日時・種別・URL・content hash索引
- [Done] OpenAPI skeletonと利用ドキュメントの更新

## 設計判断

Sourceの論理削除時にRecordの`source_id`を解除しない。削除は「新規利用を停止する」操作であり、過去データの出典を消す操作ではない。

RecordへSourceを関連付ける処理では、Source行をkey-share lockして有効性を確認する。Source検証、Record親行、Version作成を同じトランザクションに含め、検証失敗時に途中データを残さない。

URLとcontent hashは重複候補の検索に使うが、取得日時や版の異なるSourceを保存できるよう一意制約にはしない。

## 検証結果

- [Done] migration `0005_elite_boom_boom.sql`をDocker上のPostgreSQLへ適用
- [Done] 基本テスト9件成功、失敗0件
- [Done] DB統合テストを含む全10件・76 assertions成功、失敗0件
- [Done] Source作成、検索、利用数、Record関連付け、論理削除、新規参照拒否、既存provenance表示、復元を確認
- [Done] Source削除中も既存Recordの別項目を更新でき、削除状態を含むSourceがレスポンスへ残ることを確認

## 次の優先事項

- [Next] Source・Recordの作成、更新、論理削除、復元を記録する監査ログ
- [Later] 重複Source候補の検出と統合支援
- [Later] WordPress・Importジョブからの冪等なSource登録
