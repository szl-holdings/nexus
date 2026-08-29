import { createFileRoute } from "@tanstack/react-router";
import { probeEstate } from "@/lib/nexus/telemetry";

export const Route = createFileRoute("/api/probes")({
  server: {
    handlers: {
      GET: async () => {
        const probes = await probeEstate(2800);
        return Response.json(probes);
      },
    },
  },
});
