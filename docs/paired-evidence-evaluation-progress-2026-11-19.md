# 根拠縮小の対比較記録 / Paired evidence evaluation / 证据精简配对评估

2026-11-19

参考: [Language Models Can Rewrite Their Own Weights, v1](https://arxiv.org/html/2611.21885v1), §2.2、Appendix E.9。採用したのは変更前後の対比較と、検証で支持されない候補を撤回する評価手順。重みの自己編集や論文の精度改善を再現したものではない。

🟢 [Done] 既存の `experiments/evidence-pruning.js` を拡張。元の根拠と候補に同じ照会・同じbyte上限を適用し、根拠ID・版・内容・処理経路を照会ごとに記録する。成功例だけでなく退行例を含む全結果を残す。元のパック・縮小候補・検証照会・予算・protocol版からSHA-256を生成する。hashは入力識別用で、署名や評価データの秘匿を保証しない。照会labelの空欄・重複を拒否し、簡易経路が1件も成立しない検証集合では候補を採用しない。

実行: `bun experiments/evidence-pruning.js`。全比較記録を取得: `bun experiments/evidence-pruning.js --json`。

検証: `bun test` で29 pass、17 skip、0 fail。候補の退行・元パック保持、根拠revision変更や評価照会変更によるhashの変化、成功例／退行例の記録、全件拒否の検証集合と重複labelの拒否を確認した。合成fixtureの一回の対比較であり、実モデル、独立した第三評価集合、複数seed、統計的有意差、総GPUコストは評価していない。

🔴 [Later] モデル評価基盤を導入したら、探索用・採否用・最終評価用の集合を分け、同一seed／token予算の対比較、試行と撤回を含む総費用、分野別の退行を記録する。最終評価を候補選びに再利用しない。

English: The existing offline pruning gate now records every paired outcome, including regressions, and fingerprints the baseline pack, candidate, validation requests, budget and protocol. Unsupported-only validation cannot approve a candidate; duplicate labels fail. Run with `--json` for the complete report. All 29 unit tests passed; 17 integration tests were skipped. This is an evidence-policy experiment, not model self-rewriting. No independent final test set, statistical significance or GPU savings has been measured.

简体中文：扩展现有离线精简实验，记录每条配对结果（包括退行），并为原始证据、候选、验证请求、预算及协议生成hash。全部请求均不受支持时不得采用候选，重复label会报错。使用 `--json` 输出完整记录。29项单元测试通过，17项集成测试跳过。此实验并非模型权重自我改写；未测量独立最终测试集、统计显著性或GPU收益。
