# SARA Knowledge Server ドキュメント

このディレクトリには、プロジェクトの重要な知識を保存します。

## 保存する内容

- 設計・アーキテクチャの決定事項
- API、データベース、外部連携の仕様
- 調査結果と技術選定の理由
- 実装方針、運用手順、移行手順
- 重要な変更履歴と未解決事項

## 運用ルール

- 重要な決定を行ったら、関連するドキュメントを同時に更新する
- 仕様変更時は、変更理由と影響範囲を記録する
- 一時的なメモと確定仕様を混在させない
- 外部サービスやリポジトリを参照した場合は、参照先と確認日を記録する
- 実装とドキュメントに差異がある場合は、未反映であることを明記する

## 現在の主要ドキュメント

- `sara-knowledge-server設計書.txt`: 全体設計仕様書
- `roadmap.md`: 実装進捗と次工程
- `database.md`: DBスキーマとmigration運用
- `authentication.md`: 認証方式と開発用seed
- `records.md`: Record CRUDとバージョン管理
- `sources.md`: Source CRUD、出典追跡、Recordとの関連付け
- `late-labeling-and-emergent-concepts.md`: 遅延ラベリングと創発的概念形成の研究仮説
- `feedback-driven-structural-updates.md`: フィードバック駆動の構造更新方針
- `structural-knowledge-emergence.md`: 構造共有・再利用・未知関係候補生成の研究設計
- `structural-factorization-and-compositional-reasoning.md`: 問題の構造分解、因子発見、制約付き合成推論の研究設計
- `cross-modal-structural-abstraction.md`: 文章・映像・音／音楽・触覚間の共有構造候補と固有残差の研究設計
- `structure-delta-transformation-memory.md`: Structure・型付き差分・変換知識・MDLの記憶設計
- `self-organizing-shared-representations.md`: 局所表現の再利用から概念候補が形成される自己組織化設計
- `dynamical-structural-validation.md`: 予測誤差・競合・恒常性・Replayによる力学的検証設計
- `spectral-neuron-assessment.md`: Spectral Neuronの評価と制約付きscorerへの限定採用方針
