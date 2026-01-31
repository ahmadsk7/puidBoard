import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Virtual DJ Rooms",
  description: "Multiplayer DJ mixer - mix together in real time",
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
