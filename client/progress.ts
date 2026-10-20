import type { DiffFile } from "../shared/rpc";
import type { FileProgress, LineComment, ReviewSettingsValues } from "../shared/settings";

const EMPTY_PROGRESS: FileProgress = {
  status: "unread",
  lineComments: [],
};

export function workspaceFiles(
  values: ReviewSettingsValues,
  workspaceId: string,
): Record<string, FileProgress> {
  return values.progressByWorkspace[workspaceId]?.files ?? {};
}

export function getFileProgress(
  values: ReviewSettingsValues,
  workspaceId: string,
  pathKey: string,
): FileProgress {
  return workspaceFiles(values, workspaceId)[pathKey] ?? EMPTY_PROGRESS;
}

export function countProgress(input: {
  files: readonly DiffFile[];
  progress: Record<string, FileProgress>;
}): { seen: number; total: number; ignored: number } {
  let seen = 0;
  let ignored = 0;
  let total = 0;
  for (const file of input.files) {
    const status = input.progress[file.pathKey]?.status ?? "unread";
    if (status === "ignored") {
      ignored += 1;
      continue;
    }
    total += 1;
    if (status === "seen") seen += 1;
  }
  return { seen, total, ignored };
}

export function withUpdatedFile(input: {
  values: ReviewSettingsValues;
  workspaceId: string;
  pathKey: string;
  update: (current: FileProgress) => FileProgress;
}): ReviewSettingsValues {
  const current = getFileProgress(input.values, input.workspaceId, input.pathKey);
  const nextFile = input.update(current);
  const workspace = input.values.progressByWorkspace[input.workspaceId] ?? { files: {} };
  return {
    ...input.values,
    progressByWorkspace: {
      ...input.values.progressByWorkspace,
      [input.workspaceId]: {
        files: {
          ...workspace.files,
          [input.pathKey]: nextFile,
        },
      },
    },
  };
}

export function workspaceHasComments(progress: Record<string, FileProgress>): boolean {
  return Object.values(progress).some(
    (file) =>
      Boolean(file.fileComment?.trim()) ||
      file.lineComments.some((comment) => comment.body.trim()),
  );
}

/** Remove file and line comments. Viewed and ignored marks stay. */
/** Clears comments in a workspace, or only on `pathKeys` when given. */
export function clearWorkspaceComments(
  values: ReviewSettingsValues,
  workspaceId: string,
  pathKeys?: ReadonlySet<string>,
): ReviewSettingsValues {
  const workspace = values.progressByWorkspace[workspaceId];
  if (!workspace) return values;
  let changed = false;
  const files: Record<string, FileProgress> = {};
  for (const [pathKey, progress] of Object.entries(workspace.files)) {
    if (pathKeys && !pathKeys.has(pathKey)) {
      files[pathKey] = progress;
      continue;
    }
    const hasComment =
      Boolean(progress.fileComment?.trim()) ||
      progress.lineComments.some((comment) => comment.body.trim());
    if (!hasComment) {
      files[pathKey] = progress;
      continue;
    }
    changed = true;
    const next: FileProgress = { ...progress, lineComments: [] };
    delete next.fileComment;
    files[pathKey] = next;
  }
  if (!changed) return values;
  return {
    ...values,
    progressByWorkspace: {
      ...values.progressByWorkspace,
      [workspaceId]: { files },
    },
  };
}

/** Drop progress entries for paths that are no longer in the snapshot. */
export function pruneWorkspaceProgress(
  values: ReviewSettingsValues,
  workspaceId: string,
  pathKeys: ReadonlySet<string>,
): ReviewSettingsValues {
  const workspace = values.progressByWorkspace[workspaceId];
  if (!workspace) return values;
  let changed = false;
  const files: Record<string, FileProgress> = {};
  for (const [pathKey, progress] of Object.entries(workspace.files)) {
    if (pathKeys.has(pathKey)) files[pathKey] = progress;
    else changed = true;
  }
  if (!changed) return values;
  return {
    ...values,
    progressByWorkspace: {
      ...values.progressByWorkspace,
      [workspaceId]: { files },
    },
  };
}

export function commentKey(comment: Pick<LineComment, "side" | "startLine" | "endLine">): string {
  return `${comment.side}:${comment.startLine}-${comment.endLine}`;
}

export function upsertLineComment(input: {
  progress: FileProgress;
  comment: LineComment;
}): FileProgress {
  const existingIndex = input.progress.lineComments.findIndex(
    (comment) => commentKey(comment) === commentKey(input.comment),
  );
  const lineComments = [...input.progress.lineComments];
  if (!input.comment.body.trim()) {
    if (existingIndex >= 0) lineComments.splice(existingIndex, 1);
  } else if (existingIndex >= 0) {
    lineComments[existingIndex] = input.comment;
  } else {
    lineComments.push(input.comment);
  }
  return { ...input.progress, lineComments };
}

export function deleteLineComment(input: {
  progress: FileProgress;
  comment: Pick<LineComment, "side" | "startLine" | "endLine">;
}): FileProgress {
  return {
    ...input.progress,
    lineComments: input.progress.lineComments.filter(
      (comment) => commentKey(comment) !== commentKey(input.comment),
    ),
  };
}
