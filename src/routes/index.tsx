import { createFileRoute } from "@tanstack/react-router";
import { Workstation } from "@/components/nexus/Workstation";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return <Workstation />;
}
