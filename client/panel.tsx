import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { DiffView } from "./diff-view";
import { CompactPanelToolbar, type CompactPanelActions } from "./file-header";
import { FileList } from "./file-list";
import { FileListDrawer } from "./file-list-drawer";
import { RepoFilterBar } from "./repo-filter-bar";
import { SendSheet } from "./send-sheet";
import { useDiffReview } from "./use-diff-review";
import { displayPathForKey, parsePathKey } from "../shared/paths";
import type { SendTarget } from "./send-review";

type HostNavigation = NonNullable<PluginWorkspacePanelProps["navigation"]> & {
  openFile?: (input: {
    workspaceId: string;
    path: string;
    serverId?: string;
  }) => void;
};

export function DiffReviewPanel({
  theme,
  layout,
  workspaceId,
  navigation,
}: PluginWorkspacePanelProps) {
  const toast = useToast();
  const review = useDiffReview(workspaceId);
  const hostNavigation = navigation as HostNavigation | undefined;
  const canViewFile = typeof hostNavigation?.openFile === "function";
  const sendToAgent = review.sendToAgent;
  const onSend = useCallback(
    (target: SendTarget) => {
      void sendToAgent(target, hostNavigation?.openAgent);
    },
    [hostNavigation?.openAgent, sendToAgent],
  );
  const selectedPathKey = review.selectedPathKey;
  const toggleViewed = review.toggleViewed;
  const ignoreFile = review.ignoreFile;
  const onToggleViewed = useCallback(() => {
    if (selectedPathKey) toggleViewed(selectedPathKey);
  }, [selectedPathKey, toggleViewed]);
  const onIgnore = useCallback(() => {
    if (selectedPathKey) ignoreFile(selectedPathKey);
  }, [ignoreFile, selectedPathKey]);
  const onViewFile = useCallback(() => {
    if (!selectedPathKey) return;
    const { submodulePath, path } = parsePathKey(selectedPathKey);
    const relative = submodulePath ? `${submodulePath}/${path}` : path;
    if (hostNavigation?.openFile) {
      hostNavigation.openFile({ workspaceId, path: relative });
      return;
    }
    toast.error("This host cannot open files in the editor yet.");
  }, [hostNavigation, selectedPathKey, toast, workspaceId]);
  const discardFile = review.discardFile;
  const onDiscardFile = useCallback(async () => {
    if (!selectedPathKey) return "No file selected";
    return discardFile(selectedPathKey);
  }, [discardFile, selectedPathKey]);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [fileListOpen, setFileListOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const closeDesktopMenu = useCallback(() => setDesktopMenuOpen(false), []);
  const openFileList = useCallback(() => setFileListOpen(true), []);
  const closeFileList = useCallback(() => setFileListOpen(false), []);
  const askClearComments = useCallback(() => {
    setDesktopMenuOpen(false);
    setConfirmClear(true);
  }, []);
  const clearComments = review.clearComments;
  const confirmClearComments = useCallback(() => {
    if (clearing) return;
    setClearing(true);
    void (async () => {
      try {
        const ok = await clearComments();
        if (ok) setConfirmClear(false);
        else toast.error("Could not clear comments");
      } finally {
        setClearing(false);
      }
    })();
  }, [clearComments, clearing, toast]);

  const compactPanelActions = useMemo((): CompactPanelActions | undefined => {
    if (!layout.compact) return undefined;
    return {
      onRefresh: review.onRefreshPress,
      onOpenFileList: openFileList,
      onAskClearComments: askClearComments,
      onSend: review.openSend,
      sendDisabled: review.files.length === 0 || review.sending,
      fileCount: review.counts.total,
      hasComments: review.hasComments,
      clearingComments: clearing,
    };
  }, [
    askClearComments,
    clearing,
    layout.compact,
    openFileList,
    review.counts.total,
    review.files.length,
    review.hasComments,
    review.onRefreshPress,
    review.openSend,
    review.sending,
  ]);

  useEffect(() => {
    if (!desktopMenuOpen || layout.platform !== "web") return;
    const doc = (
      globalThis as {
        document?: {
          addEventListener: (type: string, listener: () => void) => void;
          removeEventListener: (type: string, listener: () => void) => void;
        };
      }
    ).document;
    if (!doc) return;
    const timer = setTimeout(() => doc.addEventListener("mousedown", closeDesktopMenu), 0);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener("mousedown", closeDesktopMenu);
    };
  }, [closeDesktopMenu, desktopMenuOpen, layout.platform]);

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 12 : 16,
        gap: 12,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        flexWrap: "wrap" as const,
        flexShrink: 0,
        position: "relative" as const,
        zIndex: desktopMenuOpen ? 100 : 1,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 20,
        fontWeight: "600" as const,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
      button: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      buttonSecondary: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      buttonText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      buttonSecondaryText: { color: theme.colors.foreground, fontWeight: "600" as const },
      menuAnchor: { position: "relative" as const, zIndex: 30 },
      menuButton: {
        width: 36,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      menuPopover: {
        position: "absolute" as const,
        top: 40,
        right: 0,
        minWidth: 180,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        paddingVertical: 4,
        zIndex: 110,
        elevation: 16,
        shadowColor: "#000",
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      menuItem: { paddingVertical: 10, paddingHorizontal: 12 },
      menuDanger: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "500" as const },
      menuMuted: { color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 2 },
      confirmBody: { color: theme.colors.foreground, fontSize: 14 },
      confirmActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        marginTop: 16,
      },
      confirmDanger: { color: theme.colors.statusDanger, fontWeight: "600" as const },
      confirmCancel: { color: theme.colors.foreground, fontWeight: "600" as const },
      body: layout.compact
        ? { flex: 1, minHeight: 0, gap: 12 }
        : { flex: 1, minHeight: 0, flexDirection: "row" as const, gap: 16 },
      listPane: { width: 280, minWidth: 220, minHeight: 0, gap: 8 },
      detailPane: { flex: 1, minHeight: 0, gap: 8 },
      paneScroll: { flex: 1, minHeight: 0 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [desktopMenuOpen, layout.compact, theme],
  );

  if (!review.workspace || review.settings.status === "loading") {
    return (
      <View style={styles.root}>
        <Text style={styles.muted}>
          {!review.workspace ? "Loading workspace…" : "Loading review settings…"}
        </Text>
      </View>
    );
  }
  if (review.settings.status !== "ready") {
    return (
      <View style={styles.root}>
        <Text style={styles.error}>{review.settings.error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={review.settings.reload}
          style={styles.buttonSecondary}
        >
          <Text style={styles.buttonSecondaryText}>Reload settings</Text>
        </Pressable>
      </View>
    );
  }

  const workspace = review.workspace;
  const emptyMessage =
    review.repos.length > 0
      ? "All changed repositories are hidden."
      : "No unstaged or untracked changes.";

  return (
    <View style={styles.root}>
      {!layout.compact ? (
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Diff Review</Text>
            <Text style={styles.muted}>{workspace.title?.trim() || workspace.name}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {review.files.length > 0 ? (
              <View style={styles.menuAnchor}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="More actions"
                  onPress={() => setDesktopMenuOpen((open) => !open)}
                  style={styles.menuButton}
                >
                  <Icon name="MoreHorizontal" size={16} color={theme.colors.foreground} />
                </Pressable>
                {desktopMenuOpen ? (
                  <View
                    style={styles.menuPopover}
                    {...(layout.platform === "web"
                      ? {
                          onMouseDown: (event: { stopPropagation?: () => void }) => {
                            event.stopPropagation?.();
                          },
                        }
                      : {})}
                  >
                    <Pressable
                      accessibilityRole="button"
                      disabled={!review.hasComments || clearing}
                      onPress={askClearComments}
                      style={styles.menuItem}
                    >
                      <Text style={styles.menuDanger}>Clear comments</Text>
                      {!review.hasComments ? (
                        <Text style={styles.menuMuted}>No comments to clear</Text>
                      ) : null}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={review.onRefreshPress}
              style={styles.buttonSecondary}
            >
              <Text style={styles.buttonSecondaryText}>Refresh</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={review.files.length === 0 || review.sending}
              onPress={review.openSend}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Send</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {review.statusMessage ? <Text style={styles.muted}>{review.statusMessage}</Text> : null}
      {review.progressError ? (
        <Pressable accessibilityRole="button" onPress={review.clearProgressError}>
          <Text style={styles.error}>{review.progressError} (tap to dismiss)</Text>
        </Pressable>
      ) : null}
      <RepoFilterBar
        repos={review.repos}
        rootLabel={workspace.name}
        theme={theme}
        onToggle={review.toggleRepo}
      />
      <View style={styles.body}>
        {!layout.compact ? (
          <View style={styles.listPane}>
            <Text style={styles.muted}>
              Viewed {review.counts.seen}/{review.counts.total}
              {review.counts.ignored > 0 ? ` · ignored ${review.counts.ignored}` : ""}
            </Text>
            {review.loadingSnapshot ? <Text style={styles.muted}>Refreshing…</Text> : null}
            {review.snapshotError ? <Text style={styles.error}>{review.snapshotError}</Text> : null}
            <ScrollView style={styles.paneScroll}>
              {review.files.length === 0 && !review.loadingSnapshot ? (
                <Text style={styles.muted}>{emptyMessage}</Text>
              ) : (
                <FileList
                  files={review.files}
                  progress={review.progress}
                  selectedPathKey={review.selectedPathKey}
                  theme={theme}
                  compact={layout.compact}
                  onSelect={review.selectFile}
                />
              )}
            </ScrollView>
          </View>
        ) : null}
        <View style={styles.detailPane}>
          {layout.compact && !review.selectedPathKey && compactPanelActions ? (
            <CompactPanelToolbar
              theme={theme}
              platform={layout.platform}
              panelActions={compactPanelActions}
            />
          ) : null}
          {review.selectedPathKey && review.selectedFile && review.cwd ? (
            <DiffView
              pathKey={review.selectedPathKey}
              displayPath={displayPathForKey(review.selectedPathKey)}
              file={review.selectedFile}
              cwd={review.cwd}
              status={review.hunkStatus}
              hunks={review.hunks}
              error={review.hunkError}
              progress={review.fileProgress}
              typography={review.typography}
              theme={theme}
              compact={layout.compact}
              platform={layout.platform}
              canViewFile={canViewFile}
              keyboardEnabled={!review.sendOpen}
              panelActions={compactPanelActions}
              onToggleViewed={onToggleViewed}
              onIgnore={onIgnore}
              onViewFile={onViewFile}
              onDiscardFile={onDiscardFile}
              onChangeFileComment={review.onChangeFileComment}
              onSaveLineComment={review.onSaveLineComment}
              onDeleteLineComment={review.onDeleteLineComment}
            />
          ) : (
            <Text style={styles.muted}>
              {layout.compact ? emptyMessage : "Select a file to review."}
            </Text>
          )}
        </View>
      </View>
      <Modal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear comments"
        icon={<Icon name="MessageSquare" size={18} color={theme.colors.foreground} />}
      >
        <Modal.Content>
          <Text style={styles.confirmBody}>
            Remove every file and line comment in this workspace? Viewed and ignored marks stay.
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              disabled={clearing}
              onPress={confirmClearComments}
            >
              <Text style={styles.confirmDanger}>{clearing ? "Clearing…" : "Clear comments"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={clearing}
              onPress={() => setConfirmClear(false)}
            >
              <Text style={styles.confirmCancel}>Cancel</Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
      <SendSheet
        open={review.sendOpen}
        onOpenChange={review.setSendOpen}
        workspaceId={workspaceId}
        theme={theme}
        sending={review.sending}
        note={review.sendNote}
        onNoteChange={review.setSendNote}
        includeFileLists={review.includeFileLists}
        onIncludeFileListsChange={review.setIncludeFileLists}
        onSend={onSend}
      />
      {layout.compact ? (
        <FileListDrawer
          open={fileListOpen}
          onClose={closeFileList}
          theme={theme}
          compact={layout.compact}
          files={review.files}
          progress={review.progress}
          selectedPathKey={review.selectedPathKey}
          counts={review.counts}
          loadingSnapshot={review.loadingSnapshot}
          snapshotError={review.snapshotError}
          onSelect={review.selectFile}
        />
      ) : null}
    </View>
  );
}
