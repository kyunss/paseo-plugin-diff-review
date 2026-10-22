import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeComposerPills } from "./client/composer-pills";
import { contributeHeaderButtons } from "./client/header-buttons";
import { DiffReviewPanel } from "./client/panel";
import { DiffReviewSettings } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "diff-review",
    title: "Diff Review",
    icon: "GitPullRequestArrow",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: DiffReviewPanel,
  });
  client.addSettingsScreen({
    id: "diff-review-prompt",
    title: "Diff Review",
    icon: "GitPullRequestArrow",
    Component: DiffReviewSettings,
  });
  client.addCommandCenterItem({
    id: "open-diff-review",
    title: "Open Diff Review",
    icon: "GitPullRequestArrow",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("diff-review");
    },
  });
  // Side by side with the agent: the Explorer dock is the only other place a plugin can open a panel.
  client.addCommandCenterItem({
    id: "open-diff-review-beside",
    title: "Open Diff Review beside",
    icon: "PanelRight",
    context: "workspace",
    keywords: ["diff", "review", "side", "split", "explorer"],
    onSelect({ openPanel }) {
      openPanel("diff-review", { location: "explorer" });
    },
  });
  // Not "/diff": plugin commands outrank provider commands and would hide Codex's /diff.
  client.addSlashCommand({
    name: "diff-review",
    description: "Open Diff Review beside the conversation",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openPanel }) {
      openPanel("diff-review", { location: "explorer" });
    },
  });
  client.addCommandCenterItem({
    id: "diff-review-settings",
    title: "Configure Diff Review prompt",
    icon: "Settings",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("diff-review-prompt");
    },
  });
  const removeHeaderButtons = contributeHeaderButtons(client);
  const removeComposerPills = contributeComposerPills(client);
  return () => {
    removeHeaderButtons();
    removeComposerPills();
  };
}
