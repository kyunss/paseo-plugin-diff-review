import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_PROMPT_TEMPLATE = `I reviewed your code and have the following comments. Please address them.

{{reviewComment}}

{{comments}}`;

/** Previous defaults. Stored templates equal to one of these are upgraded on read. */
const LEGACY_DEFAULT_PROMPT_TEMPLATES = new Set([
  `Review the following changes in {{workspace}}.

## Comments
{{comments}}

## General comment
{{reviewComment}}`,
  `Review the following changes in {{workspace}}.

## Comments
{{comments}}

## General comment
{{reviewComment}}

Please summarize risks, suggest follow-ups, and call out anything that should not be staged yet.`,
  `Review the following unstaged changes in {{workspace}}.

## Comments
{{comments}}

## General comment
{{reviewComment}}

Please summarize risks, suggest follow-ups, and call out anything that should not be staged yet.`,
  `Review the following unstaged changes in {{workspace}}.

Files reviewed (seen): {{seenCount}} / {{totalCount}}
Ignored: {{ignoredCount}}

## Comments
{{comments}}

## Seen files without comments (will be staged after send)
{{seenUncommented}}

Please summarize risks, suggest follow-ups, and call out anything that should not be staged yet.`,
]);

export const DEFAULT_DIFF_FONT_SIZE = 12;
export const DEFAULT_DIFF_LINE_HEIGHT = 18;
export const DEFAULT_DIFF_FONT_FAMILY = "monospace";

const LineCommentSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  side: z.enum(["old", "new"]),
  body: z.string(),
});

const FileProgressSchema = z.object({
  status: z.enum(["unread", "seen", "ignored"]).default("unread"),
  fileComment: z.string().optional(),
  lineComments: z.array(LineCommentSchema).default([]),
});

const WorkspaceProgressSchema = z.object({
  files: z.record(z.string(), FileProgressSchema).default({}),
});

const DiffTypographySchema = z.object({
  fontSize: z.number().positive().default(DEFAULT_DIFF_FONT_SIZE),
  lineHeight: z.number().positive().default(DEFAULT_DIFF_LINE_HEIGHT),
  fontFamily: z.string().min(1).default(DEFAULT_DIFF_FONT_FAMILY),
});

export const reviewSettings = defineSettings({
  id: "diff-review",
  scope: "host",
  version: 1,
  schema: z.object({
    promptTemplate: z
      .string()
      .default(DEFAULT_PROMPT_TEMPLATE)
      .transform((value) =>
        LEGACY_DEFAULT_PROMPT_TEMPLATES.has(value) ? DEFAULT_PROMPT_TEMPLATE : value,
      ),
    progressByWorkspace: z.record(z.string(), WorkspaceProgressSchema).default({}),
    /**
     * Repository keys (see `repoKeyOf`) hidden from the file list, per workspace directory so
     * every session on the same checkout shares them.
     */
    hiddenReposByDirectory: z.record(z.string(), z.array(z.string())).default({}),
    diffTypography: DiffTypographySchema.default({
      fontSize: DEFAULT_DIFF_FONT_SIZE,
      lineHeight: DEFAULT_DIFF_LINE_HEIGHT,
      fontFamily: DEFAULT_DIFF_FONT_FAMILY,
    }),
  }),
});

export type ReviewSettingsValues = z.infer<typeof reviewSettings.schema>;
export type FileProgress = z.infer<typeof FileProgressSchema>;
export type LineComment = z.infer<typeof LineCommentSchema>;
export type DiffTypography = z.infer<typeof DiffTypographySchema>;
