import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'EXALT Songbook — CCF Tarlac', description:'One song library. Ready for Sunday. Worship songs, chord sheets, and service lineups for CCF Tarlac.'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="en"><body>{children}</body></html>;}
