import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FB Group Spam Sentinel',
  description: 'Trợ lý Tương tác & Lọc bài Facebook',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
