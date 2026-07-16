// /apps/admin/src/app/layout.js
import './globals.css';

export const metadata = {
  title: 'SARA Knowledge Server',
  description: 'Knowledge and memory management console',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
