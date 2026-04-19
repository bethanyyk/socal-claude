import './globals.css';
import { WebSocketProvider } from '../components/WebSocketContext';
import Nav from '../components/Nav';

export const metadata = {
  title: 'Locus — Personal Attention Research',
  description: 'Track and improve your focus over time',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white">
        <WebSocketProvider>
          <Nav />
          <main className="max-w-6xl mx-auto px-6 py-6">
            {children}
          </main>
        </WebSocketProvider>
      </body>
    </html>
  );
}
