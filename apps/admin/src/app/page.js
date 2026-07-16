// /apps/admin/src/app/page.js
export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">SARA KNOWLEDGE SERVER</p>
        <h1 id="page-title">知識を、モデルから切り離して育てる。</h1>
        <p className="lead">
          PostgreSQLを正本とする、学習データ・イベント記憶・関係データの管理基盤です。
        </p>
        <div className="status-card">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Phase 1 基盤起動中</strong>
            <p>API、管理画面、PostgreSQL、Redis、MinIOを準備しています。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
