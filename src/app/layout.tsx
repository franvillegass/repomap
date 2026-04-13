import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title:       'RepoMap',
  description: 'Architecture diagrams from GitHub repositories',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
} 