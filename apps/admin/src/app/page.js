// /apps/admin/src/app/page.js
'use client';

import { useEffect, useState } from 'react';

const copy = {
  ja: {
    language: '表示言語',
    title: '知識を、モデルから切り離して育てる。',
    lead: 'PostgreSQLを正本とする、学習データ・イベント記憶・関係データの管理基盤です。',
    status: 'Phase 1 基盤稼働中',
    detail: 'API、認証、Record版履歴、PostgreSQL、Redis、MinIOが利用できます。',
  },
  en: {
    language: 'Language',
    title: 'Grow knowledge beyond the model.',
    lead: 'A PostgreSQL system of record for training data, event memory, and relational knowledge.',
    status: 'Phase 1 foundation running',
    detail: 'API, authentication, record versioning, PostgreSQL, Redis, and MinIO are available.',
  },
  'zh-Hans': {
    language: '显示语言',
    title: '让知识脱离模型，持续成长。',
    lead: '以 PostgreSQL 为唯一事实来源，管理训练数据、事件记忆和关系知识。',
    status: '第一阶段基础服务运行中',
    detail: 'API、身份验证、记录版本、PostgreSQL、Redis 和 MinIO 均可使用。',
  },
};

export default function HomePage() {
  const [locale, setLocale] = useState('ja');
  const text = copy[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <header className="topline">
          <p className="eyebrow">SARA KNOWLEDGE SERVER</p>
          <label className="language-picker">
            <span>{text.language}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value)}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="zh-Hans">简体中文</option>
            </select>
          </label>
        </header>
        <h1 id="page-title">{text.title}</h1>
        <p className="lead">{text.lead}</p>
        <div className="status-card">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{text.status}</strong>
            <p>{text.detail}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
