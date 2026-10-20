import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Adds an "Open Diff Review" button to every workspace header. Phones have no new-tab launcher,
 * so without it the panel is reachable only through Command Center search.
 */
export function contributeHeaderButtons(client: PluginClientContext): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  let release: (() => void) | null = null;

  const add = (workspaceId: string) => {
    if (stopped || buttons.has(workspaceId)) return;
    const registration = client.addHeaderButton({
      id: "open-diff-review",
      workspaceId,
      button: {
        title: "Open Diff Review",
        icon: "GitPullRequestArrow",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("diff-review", { workspaceId });
          },
        },
      },
    });
    buttons.set(workspaceId, registration);
  };
  const remove = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };
  const clear = () => {
    for (const registration of buttons.values()) registration.remove();
    buttons.clear();
  };

  void client.paseo.workspaces
    .list({ subscribe: {}, sort: [{ key: "activity_at", direction: "desc" }] })
    .then(({ subscription }) => {
      if (stopped) {
        void subscription.release();
        return;
      }
      const unsubscribe = subscription.subscribe({
        snapshot: ({ entries }) => {
          clear();
          for (const workspace of entries) add(workspace.id);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.id);
          else add(update.workspace.id);
        },
      });
      release = () => {
        unsubscribe();
        void subscription.release();
      };
    })
    .catch((error) => {
      if (!stopped) console.error("Diff Review: workspace observation failed", error);
    });

  return () => {
    stopped = true;
    release?.();
    clear();
  };
}
