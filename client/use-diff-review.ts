import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePaseo,
  useRpc,
  useSettings,
  useWorkspace,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  countProgress,
  deleteLineComment,
  getFileProgress,
  clearWorkspaceComments,
  pruneWorkspaceProgress,
  upsertLineComment,
  withUpdatedFile,
  workspaceFiles,
  workspaceHasComments,
} from "./progress";
import { treeOrderedFiles } from "./file-tree";
import { repoKeyOf, summarizeRepos, withToggledRepo } from "./repo-filter";
import { sendDiffReview, type SendTarget } from "./send-review";
import {
  diffDiscardRpc,
  diffHunksRpc,
  diffSnapshotRpc,
  diffStageRpc,
  type DiffFile,
  type DiffHunk,
} from "../shared/rpc";
import {
  DEFAULT_DIFF_FONT_FAMILY,
  DEFAULT_DIFF_FONT_SIZE,
  DEFAULT_DIFF_LINE_HEIGHT,
  reviewSettings,
  type DiffTypography,
  type LineComment,
  type ReviewSettingsValues,
} from "../shared/settings";

type ReadySettings = Extract<SettingsState<typeof reviewSettings.schema>, { status: "ready" }>;

const EMPTY_PROGRESS = { status: "unread" as const, lineComments: [] };
const EMPTY_SETTINGS: ReviewSettingsValues = {
  promptTemplate: "",
  progressByWorkspace: {},
  hiddenReposByDirectory: {},
  diffTypography: {
    fontSize: DEFAULT_DIFF_FONT_SIZE,
    lineHeight: DEFAULT_DIFF_LINE_HEIGHT,
    fontFamily: DEFAULT_DIFF_FONT_FAMILY,
  },
};
const EMPTY_FILES: Record<string, typeof EMPTY_PROGRESS> = {};
const NO_HIDDEN_REPOS: string[] = [];
const DEFAULT_TYPOGRAPHY: DiffTypography = EMPTY_SETTINGS.diffTypography;

export function useDiffReview(workspaceId: string) {
  const paseo = usePaseo();
  const workspace = useWorkspace(workspaceId, ({ name, directory, title }) => ({
    name,
    directory,
    title,
  }));
  const settings = useSettings(reviewSettings);
  const snapshot = useRpc(diffSnapshotRpc);
  const loadHunks = useRpc(diffHunksRpc);
  const stage = useRpc(diffStageRpc);
  const discard = useRpc(diffDiscardRpc);

  const [allFiles, setAllFiles] = useState<DiffFile[]>([]);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [selectedPathKey, setSelectedPathKey] = useState<string | null>(null);
  const [hunkStatus, setHunkStatus] = useState<
    "ok" | "binary" | "too_large" | "missing" | "loading"
  >("loading");
  const [hunks, setHunks] = useState<DiffHunk[]>([]);
  const [hunkError, setHunkError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendNote, setSendNote] = useState("");
  const [includeFileLists, setIncludeFileLists] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);

  const cwd = workspace?.directory ?? null;
  const ready = settings.status === "ready" ? (settings as ReadySettings) : null;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const progressSnapshotRef = useRef<{
    values: ReviewSettingsValues;
    revision: string;
  } | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const pendingSavesRef = useRef(0);

  useEffect(() => {
    if (!ready) {
      progressSnapshotRef.current = null;
      return;
    }
    if (pendingSavesRef.current === 0) {
      progressSnapshotRef.current = { values: ready.values, revision: ready.revision };
      return;
    }
    const snap = progressSnapshotRef.current;
    if (snap && ready.revision !== snap.revision) {
      progressSnapshotRef.current = { values: snap.values, revision: ready.revision };
    }
  }, [ready]);

  const progress = useMemo(
    () => (ready ? workspaceFiles(ready.values, workspaceId) : EMPTY_FILES),
    [ready, workspaceId],
  );
  const hiddenRepoList = (cwd && ready?.values.hiddenReposByDirectory[cwd]) || NO_HIDDEN_REPOS;
  const hiddenRepos = useMemo(() => new Set(hiddenRepoList), [hiddenRepoList]);
  const repos = useMemo(() => summarizeRepos(allFiles, hiddenRepos), [allFiles, hiddenRepos]);
  // Everything downstream (counts, navigation, send, stage) sees only the shown repositories.
  const files = useMemo(
    () => allFiles.filter((file) => !hiddenRepos.has(repoKeyOf(file))),
    [allFiles, hiddenRepos],
  );
  const counts = useMemo(() => countProgress({ files, progress }), [files, progress]);
  const selectedFile = useMemo(
    () => files.find((file) => file.pathKey === selectedPathKey) ?? null,
    [files, selectedPathKey],
  );
  const fileProgress = useMemo(() => {
    if (!selectedPathKey) return EMPTY_PROGRESS;
    return getFileProgress(ready?.values ?? EMPTY_SETTINGS, workspaceId, selectedPathKey);
  }, [ready?.values, selectedPathKey, workspaceId]);

  const waitForRevision = useCallback((fromRevision: string) => {
    return new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        const current = readyRef.current;
        if (current && current.revision !== fromRevision) {
          resolve();
          return;
        }
        if (Date.now() - started > 5_000) {
          resolve();
          return;
        }
        setTimeout(tick, 0);
      };
      tick();
    });
  }, []);

  const saveProgress = useCallback(
    (update: (values: ReviewSettingsValues) => ReviewSettingsValues): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        const live = readyRef.current;
        if (!live) return false;
        if (!progressSnapshotRef.current) {
          progressSnapshotRef.current = { values: live.values, revision: live.revision };
        }
        const snap = progressSnapshotRef.current;
        const nextValues = update(snap.values);
        if (nextValues === snap.values) return true;
        const fromRevision = snap.revision;
        const ok = await live.save(nextValues, fromRevision);
        if (!ok) {
          progressSnapshotRef.current = null;
          setProgressError(live.saveError ?? "Could not save review progress");
          return false;
        }
        progressSnapshotRef.current = { values: nextValues, revision: fromRevision };
        setProgressError(null);
        await waitForRevision(fromRevision);
        const after = readyRef.current;
        if (after) {
          progressSnapshotRef.current = {
            values: progressSnapshotRef.current?.values ?? nextValues,
            revision: after.revision,
          };
        }
        return true;
      };

      pendingSavesRef.current += 1;
      const queued = saveQueueRef.current.then(run, run);
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued.finally(() => {
        pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
      });
    },
    [waitForRevision],
  );

  const refreshSnapshot = useCallback(async () => {
    if (!cwd) {
      setSnapshotError("Workspace directory unavailable");
      setAllFiles([]);
      return;
    }
    setLoadingSnapshot(true);
    try {
      const result = await snapshot({ cwd });
      setAllFiles(result.files);
      setSnapshotError(result.error);
      // Prune against every changed file so comments on hidden repositories survive.
      const pathKeys = new Set(result.files.map((file) => file.pathKey));
      void saveProgress((values) => {
        const next = pruneWorkspaceProgress(values, workspaceId, pathKeys);
        return next === values ? values : next;
      });
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : String(error));
      setAllFiles([]);
    } finally {
      setLoadingSnapshot(false);
    }
  }, [cwd, saveProgress, snapshot, workspaceId]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    setSelectedPathKey((current) => {
      if (current && files.some((file) => file.pathKey === current)) return current;
      return files[0]?.pathKey ?? null;
    });
  }, [files]);

  const selectFile = useCallback((pathKey: string) => {
    setSelectedPathKey(pathKey);
  }, []);

  const toggleRepo = useCallback(
    (key: string) => {
      if (!cwd) return;
      const showing = hiddenRepos.has(key);
      void (async () => {
        const ok = await saveProgress((values) => withToggledRepo(values, cwd, key));
        if (!ok || !showing) return;
        // Hiding moved the selection elsewhere; showing a repository again opens its first file.
        const first = treeOrderedFiles(allFiles).find((file) => repoKeyOf(file) === key);
        if (first) setSelectedPathKey(first.pathKey);
      })();
    },
    [allFiles, cwd, hiddenRepos, saveProgress],
  );

  const orderedFiles = useMemo(() => treeOrderedFiles(files), [files]);

  const selectNextFile = useCallback(
    (fromPathKey: string) => {
      const index = orderedFiles.findIndex((file) => file.pathKey === fromPathKey);
      if (index < 0) return;
      const isOpen = (pathKey: string) => {
        if (pathKey === fromPathKey) return false;
        const status = progress[pathKey]?.status ?? "unread";
        return status !== "ignored" && status !== "seen";
      };
      const next = orderedFiles.slice(index + 1).find((file) => isOpen(file.pathKey));
      if (next) {
        setSelectedPathKey(next.pathKey);
        return;
      }
      const wrap = orderedFiles.slice(0, index).find((file) => isOpen(file.pathKey));
      if (wrap) setSelectedPathKey(wrap.pathKey);
    },
    [orderedFiles, progress],
  );

  const typography = ready?.values.diffTypography ?? DEFAULT_TYPOGRAPHY;

  const toggleViewed = useCallback(
    async (pathKey: string) => {
      const current = progress[pathKey]?.status ?? "unread";
      const markingViewed = current !== "seen";
      const ok = await saveProgress((values) =>
        withUpdatedFile({
          values,
          workspaceId,
          pathKey,
          update: (file) => ({
            ...file,
            status: markingViewed ? "seen" : "unread",
          }),
        }),
      );
      if (ok && markingViewed) selectNextFile(pathKey);
    },
    [progress, saveProgress, selectNextFile, workspaceId],
  );

  const ignoreFile = useCallback(
    async (pathKey: string) => {
      const current = progress[pathKey]?.status ?? "unread";
      const markingIgnored = current !== "ignored";
      const ok = await saveProgress((values) =>
        withUpdatedFile({
          values,
          workspaceId,
          pathKey,
          update: (file) => ({
            ...file,
            status: markingIgnored ? "ignored" : "unread",
          }),
        }),
      );
      if (ok && markingIgnored) selectNextFile(pathKey);
    },
    [progress, saveProgress, selectNextFile, workspaceId],
  );

  const discardFile = useCallback(
    async (pathKey: string): Promise<string | null> => {
      if (!cwd) return "Workspace directory unavailable";
      try {
        const result = await discard({ cwd, pathKey });
        if (!result.ok) return result.error ?? "Could not discard file changes";
        selectNextFile(pathKey);
        await refreshSnapshot();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [cwd, discard, refreshSnapshot, selectNextFile],
  );

  useEffect(() => {
    if (!cwd || !selectedPathKey) {
      setHunks([]);
      setHunkStatus("missing");
      return;
    }
    let cancelled = false;
    setHunkStatus("loading");
    void (async () => {
      try {
        const result = await loadHunks({ cwd, pathKey: selectedPathKey });
        if (cancelled) return;
        setHunks(result.hunks);
        setHunkStatus(result.status);
        setHunkError(result.error);
      } catch (error) {
        if (cancelled) return;
        setHunks([]);
        setHunkStatus("missing");
        setHunkError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, loadHunks, selectedPathKey]);

  const onChangeFileComment = useCallback(
    async (body: string): Promise<boolean> => {
      if (!selectedPathKey) return false;
      const trimmed = body.trim();
      return saveProgress((values) =>
        withUpdatedFile({
          values,
          workspaceId,
          pathKey: selectedPathKey,
          update: (current) => {
            const next = { ...current };
            if (trimmed) next.fileComment = trimmed;
            else delete next.fileComment;
            return next;
          },
        }),
      );
    },
    [saveProgress, selectedPathKey, workspaceId],
  );

  const onSaveLineComment = useCallback(
    async (comment: LineComment): Promise<boolean> => {
      if (!selectedPathKey) return false;
      return saveProgress((values) =>
        withUpdatedFile({
          values,
          workspaceId,
          pathKey: selectedPathKey,
          update: (current) => upsertLineComment({ progress: current, comment }),
        }),
      );
    },
    [saveProgress, selectedPathKey, workspaceId],
  );

  const onDeleteLineComment = useCallback(
    async (comment: Pick<LineComment, "side" | "startLine" | "endLine">): Promise<boolean> => {
      if (!selectedPathKey) return false;
      return saveProgress((values) =>
        withUpdatedFile({
          values,
          workspaceId,
          pathKey: selectedPathKey,
          update: (current) => deleteLineComment({ progress: current, comment }),
        }),
      );
    },
    [saveProgress, selectedPathKey, workspaceId],
  );

  const clearComments = useCallback(async (): Promise<boolean> => {
    return saveProgress((values) => clearWorkspaceComments(values, workspaceId));
  }, [saveProgress, workspaceId]);

  const openSend = useCallback(() => setSendOpen(true), []);
  const onRefreshPress = useCallback(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);
  const clearProgressError = useCallback(() => setProgressError(null), []);

  const sendToAgent = useCallback(
    async (target: SendTarget, openAgent: ((input: { agentId: string }) => void) | undefined) => {
      if (!ready || !cwd) return;
      setSending(true);
      setStatusMessage(null);
      try {
        const result = await sendDiffReview({
          paseo,
          cwd,
          workspaceId,
          workspaceName: workspace?.title?.trim() || workspace?.name || workspaceId,
          files,
          values: ready.values,
          target,
          reviewComment: sendNote,
          includeFileLists,
          stage,
        });
        // Only sent files lose their comments; hidden repositories keep theirs.
        const sentPathKeys = new Set(files.map((file) => file.pathKey));
        await saveProgress((values) => clearWorkspaceComments(values, workspaceId, sentPathKeys));
        setStatusMessage(result.statusMessage);
        openAgent?.({ agentId: result.agentId });
        setSendNote("");
        setSendOpen(false);
        await refreshSnapshot();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setSending(false);
      }
    },
    [
      cwd,
      files,
      includeFileLists,
      paseo,
      ready,
      refreshSnapshot,
      saveProgress,
      sendNote,
      stage,
      workspace?.name,
      workspace?.title,
      workspaceId,
    ],
  );

  return {
    workspace,
    settings,
    files,
    repos,
    toggleRepo,
    snapshotError,
    loadingSnapshot,
    selectedPathKey,
    selectedFile,
    hunkStatus,
    hunks,
    hunkError,
    sendOpen,
    setSendOpen,
    sendNote,
    setSendNote,
    includeFileLists,
    setIncludeFileLists,
    sending,
    statusMessage,
    progressError: progressError ?? settings.saveError,
    clearProgressError,
    cwd,
    progress,
    counts,
    hasComments: workspaceHasComments(progress),
    fileProgress,
    typography,
    toggleViewed,
    ignoreFile,
    discardFile,
    selectFile,
    onChangeFileComment,
    onSaveLineComment,
    onDeleteLineComment,
    clearComments,
    openSend,
    onRefreshPress,
    sendToAgent,
  };
}
