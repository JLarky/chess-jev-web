import "./globals.css";

export const metadata = {
  title: "Jev Chess",
  description:
    "Play chess against TypeSafe's Jev. Legal moves only, or chaos mode where anything goes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
