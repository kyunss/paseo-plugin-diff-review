import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execCommand } from "@getpaseo/plugin/server";

export async function runGit(
  cwd: string,
  args: string[],
  options?: { acceptExitCodes?: number[] },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execCommand("git", args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    if (options?.acceptExitCodes?.includes(exitCode)) {
      return {
        stdout: typeof err.stdout === "string" ? err.stdout : "",
        stderr: typeof err.stderr === "string" ? err.stderr : "",
        exitCode,
      };
    }
    throw new Error(err.stderr?.trim() || err.message || `git ${args.join(" ")} failed`, {
      cause: error,
    });
  }
}

export function resolveSubmoduleCwd(parentCwd: string, subPath: string): string | null {
  const subCwd = join(parentCwd, subPath);
  if (!existsSync(subCwd) || !existsSync(join(subCwd, ".git"))) {
    return null;
  }
  return subCwd;
}

export type NestedRepo = {
  /** Workspace-relative checkout path; used as `submodulePath` in path keys. */
  path: string;
  cwd: string;
};

const MAX_NESTED_DEPTH = 4;

/**
 * Initialized nested repositories under a workspace, outermost first: submodules (also
 * those `.gitmodules` hides with `ignore = all`), submodules of submodules, and tracked
 * symlinks that point at another Git checkout.
 */
export async function listNestedRepos(rootCwd: string): Promise<NestedRepo[]> {
  const repos: NestedRepo[] = [];
  const visited = new Set([realpathSync(rootCwd)]);
  await collectNestedRepos(rootCwd, "", 1, visited, repos);
  return repos;
}

async function collectNestedRepos(
  repoCwd: string,
  prefix: string,
  depth: number,
  visited: Set<string>,
  out: NestedRepo[],
): Promise<void> {
  if (depth > MAX_NESTED_DEPTH) return;
  const { stdout } = await runGit(repoCwd, ["ls-files", "-s", "-z"], { acceptExitCodes: [0] });
  const children: NestedRepo[] = [];
  for (const entry of stdout.split("\0").filter(Boolean)) {
    // Gitlinks are submodules; symlinks only count when their target is a checkout.
    const match = entry.match(/^(?:160000|120000) [0-9a-f]+ \d+\t(.+)$/);
    if (!match?.[1]) continue;
    const cwd = resolveSubmoduleCwd(repoCwd, match[1]);
    if (!cwd) continue;
    const real = realpathSync(cwd);
    if (visited.has(real)) continue;
    visited.add(real);
    children.push({ path: prefix ? `${prefix}/${match[1]}` : match[1], cwd });
  }
  const subtrees = await Promise.all(
    children.map(async (child) => {
      const subtree = [child];
      await collectNestedRepos(child.cwd, child.path, depth + 1, visited, subtree);
      return subtree;
    }),
  );
  out.push(...subtrees.flat());
}
