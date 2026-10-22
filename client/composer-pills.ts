import { Platform } from "react-native";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Adds an "Open Diff Review" pill to every agent's composer on phones. Paseo 0.12 dropped
 * plugin header buttons from the compact mobile header, while composer pills still render
 * there. Desktop keeps the header button, so the pill is skipped on web.
 */
export function contributeComposerPills(client: PluginClientContext): () => void {
  if (Platform.OS === "web") return () => {};

  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();

  const add = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId || pills.has(agent.id)) return;
    const workspaceId = agent.workspaceId;
    const registration = client.addComposerPill({
      id: "open-diff-review",
      workspaceId,
      agentId: agent.id,
      button: {
        title: "Open Diff Review",
        icon: "GitPullRequestArrow",
        label: "Diff Review",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("diff-review", { workspaceId, agentId: agent.id });
          },
        },
      },
    });
    pills.set(agent.id, registration);
  };
  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const clear = () => {
    for (const registration of pills.values()) registration.remove();
    pills.clear();
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          clear();
          for (const { agent } of entries) add(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else add(update.agent);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Diff Review: agent observation failed", error);
    });

  return () => {
    lifetime.abort();
    clear();
  };
}
