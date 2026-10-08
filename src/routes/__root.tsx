import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import "../styles.css";

const APP_NAME = "NEXUS MK-II";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0A0C0E" },
      {
        name: "description",
        content:
          "NEXUS MK-II — holographic analog computer. Six programs, analog circuits, analog correlator, hybrid IC, five-organ anatomy, WILLAY second brain, optical 3-factor STDP, Ouroboros, Hatun telemetry, phosphor CRT.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
