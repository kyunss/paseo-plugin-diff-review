import type { DiffFile } from "../shared/rpc";
import type { ReviewSettingsValues } from "../shared/settings";

/** Key for the workspace's own repository; nested checkouts use their workspace path. */
export const ROOT_REPO_KEY = ".";

export type RepoSummary = {
  key: string;
  fileCount: number;
  hidden: boolean;
};

export function repoKeyOf(file: DiffFile): string {
  return file.submodulePath ?? ROOT_REPO_KEY;
}

/** Repositories that currently have changes, root first, then by path. */
export function summarizeRepos(
  files: readonly DiffFile[],
  hidden: ReadonlySet<string>,
): RepoSummary[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const key = repoKeyOf(file);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, fileCount]) => ({ key, fileCount, hidden: hidden.has(key) }))
    .sort((left, right) => {
      if (left.key === ROOT_REPO_KEY) return -1;
      if (right.key === ROOT_REPO_KEY) return 1;
      return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    });
}

export function withToggledRepo(
  values: ReviewSettingsValues,
  directory: string,
  key: string,
): ReviewSettingsValues {
  const current = values.hiddenReposByDirectory[directory] ?? [];
  const next = current.includes(key)
    ? current.filter((entry) => entry !== key)
    : [...current, key];
  return {
    ...values,
    hiddenReposByDirectory: { ...values.hiddenReposByDirectory, [directory]: next },
  };
}
