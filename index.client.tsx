import type { PluginClientContext } from "@getpaseo/plugin/client";
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
  client.addCommandCenterItem({
    id: "diff-review-settings",
    title: "Configure Diff Review prompt",
    icon: "Settings",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("diff-review-prompt");
    },
  });
  return contributeHeaderButtons(client);
}
