import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "UseUrPool",
  description: "Pick the best champion from your own pool.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="wordmark">
            <span className="wm-use">Use</span>
            <span className="wm-ur">Ur</span>
            <span className="wm-pool">Pool</span>
          </Link>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          UseUrPool isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
          opinions of Riot Games or anyone officially involved in producing or managing Riot
          Games properties. Riot Games, and all associated properties are trademarks or
          registered trademarks of Riot Games, Inc.
        </footer>
      </body>
    </html>
  );
}
