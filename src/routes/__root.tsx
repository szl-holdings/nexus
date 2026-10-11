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
      { name: "theme-color", content: "#080B12" },
      {
        name: "description",
        content:
          "NEXUS MK-II — holographic analog computer. Six programs, analog circuits, analog correlator, hybrid IC, five-organ anatomy, WILLAY second brain, optical 3-factor STDP, Ouroboros, Hatun telemetry, phosphor CRT.",
      },
    ],
    links: [
      { rel: "stylesheet", href: "/assets/szl/szl-tokens.css" },
      { rel: "icon", type: "image/svg+xml", href: "/assets/szl/szl-icon-16.svg" },
    ],
  }),
  component: () => (
    <html lang="en" data-surface="dark" suppressHydrationWarning className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <noscript>
          <div className="nx-no-script">
            <h1>Nexus · Instrument MK-II</h1>
            <p>
              This browser-local Web Audio workstation needs JavaScript for its controls. Audio
              begins only after you choose to engage. Energy remains UNAVAILABLE; Conjecture 1
              remains OPEN.
            </p>
            <a href="https://github.com/szl-holdings/nexus">Read the technical guide and source</a>
          </div>
        </noscript>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
