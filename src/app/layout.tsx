import "./globals.css";

export const metadata = {
  title: "Trivia Live",
  description: "Host-controlled live trivia with Final Jeopardy"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
