import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ROOT_REPO_KEY, type RepoSummary } from "./repo-filter";

interface RepoFilterBarProps {
  repos: readonly RepoSummary[];
  rootLabel: string;
  theme: PluginSurfaceProps["theme"];
  onToggle(key: string): void;
}

/** Chips that show or hide each changed repository; hidden ones stay listed, dimmed. */
export function RepoFilterBar({ repos, rootLabel, theme, onToggle }: RepoFilterBarProps) {
  const styles = useMemo(
    () => ({
      bar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        flexShrink: 0,
      },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
      },
      chipShown: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface1 },
      chipHidden: { borderColor: theme.colors.border, backgroundColor: "transparent" },
      label: { fontSize: 12, fontWeight: "500" as const },
      labelShown: { color: theme.colors.foreground },
      labelHidden: {
        color: theme.colors.foregroundMuted,
        textDecorationLine: "line-through" as const,
      },
      count: { fontSize: 11, color: theme.colors.foregroundMuted },
    }),
    [theme],
  );

  // A single repository needs no filter unless it was hidden and must be shown again.
  if (repos.length < 2 && !repos.some((repo) => repo.hidden)) return null;

  return (
    <View style={styles.bar}>
      {repos.map((repo) => (
        <Pressable
          key={repo.key}
          accessibilityRole="button"
          accessibilityState={{ selected: !repo.hidden }}
          accessibilityLabel={`${repo.hidden ? "Show" : "Hide"} ${repo.key}`}
          onPress={() => onToggle(repo.key)}
          style={[styles.chip, repo.hidden ? styles.chipHidden : styles.chipShown]}
        >
          <Text style={[styles.label, repo.hidden ? styles.labelHidden : styles.labelShown]}>
            {repo.key === ROOT_REPO_KEY ? rootLabel : repo.key}
          </Text>
          <Text style={styles.count}>{repo.fileCount}</Text>
        </Pressable>
      ))}
    </View>
  );
}
