import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { diffPalette } from "./colors";
import type { DisplayLine } from "./diff-display";
import { DiffLineRow } from "./diff-line-row";
import {
  commentsAfterLine,
  draftSelectionRange,
  isDraftComposerLine,
  lineInRange,
  lineNumberForSide,
  lineSide,
} from "./diff-line-utils";
import { ExpandGapButton } from "./expand-gap-button";
import { LineDraftBox, type LineDraftRange } from "./line-draft-box";
import { diffViewFrameStyles, diffViewStatusMessage } from "./diff-view-layout";
import { FileHeader } from "./file-header";
import { InlineCommentCard } from "./inline-comment";
import {
  isEditableTarget,
  nextReviewKey,
  reviewModifierAction,
  webDocument,
  type ReviewKeyAction,
  type WebKeyEvent,
} from "./keyboard";
import { commentKey } from "./progress";
import { type DiffFile, type DiffHunk, type DiffLine } from "../shared/rpc";
import type { DiffTypography, FileProgress, LineComment } from "../shared/settings";
import { NativeDiffView } from "./diff-view-native";
import type { DiffViewProps } from "./diff-view-props";
import { useDiffExpand } from "./use-diff-expand";
import { useScrollComposerIntoView } from "./use-scroll-composer-into-view";

type Theme = PluginSurfaceProps["theme"];

type LineRange = { side: "old" | "new"; startLine: number; endLine: number };
type RowNode = ComponentRef<typeof View>;

function isSelectableLine(line: DisplayLine): boolean {
  const side = lineSide(line);
  return side != null && lineNumberForSide(line, side) != null;
}

/** Inclusive range between two display lines, using the side of the first line. */
function rangeBetween(
  lines: readonly DisplayLine[],
  fromId: string,
  toId: string,
): LineRange | null {
  const from = lines.findIndex((line) => line.id === fromId);
  const to = lines.findIndex((line) => line.id === toId);
  if (from < 0 || to < 0) return null;
  const side = lineSide(lines[from]!);
  if (!side) return null;
  let startLine: number | null = null;
  let endLine: number | null = null;
  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    const number = lineNumberForSide(lines[index]!, side);
    if (number == null) continue;
    startLine = startLine == null ? number : Math.min(startLine, number);
    endLine = endLine == null ? number : Math.max(endLine, number);
  }
  if (startLine == null || endLine == null) return null;
  return { side, startLine, endLine };
}

const IDLE_MARK = { cursor: false, selected: false };

type LineMark = { cursor: boolean; selected: boolean };
type ScrollAlign = "nearest" | "start" | "end" | "pin";

/**
 * Line marker kept outside React state. A j/k repeat must not re-render the file:
 * rows subscribe here and bail out unless their own cursor or selection bit changes.
 * A factory, not a class: the mobile apps' Hermes engine drops a plugin client bundle that
 * contains `class` syntax (getpaseo/paseo#5783).
 */
function createLineCursorStore() {
  let lines: readonly DisplayLine[] = [];
  let indexById = new Map<string, number>();
  let selected = new Set<string>();
  const marks = new Map<string, LineMark>();
  const listeners = new Map<string, Set<() => void>>();
  const subscribeFns = new Map<string, (listener: () => void) => () => void>();
  const scrollListeners = new Set<() => void>();

  const emitIds = (ids: Iterable<string>) => {
    for (const id of ids) {
      const bucket = listeners.get(id);
      if (!bucket) continue;
      for (const listener of bucket) listener();
    }
  };

  const emitAll = () => {
    for (const bucket of listeners.values()) {
      for (const listener of bucket) listener();
    }
  };

  const emitScroll = () => {
    for (const listener of scrollListeners) listener();
  };

  const diffIds = (
    prevSelected: ReadonlySet<string>,
    nextSelected: ReadonlySet<string>,
    cursorId: string | null,
  ): Set<string> => {
    const dirty = new Set<string>();
    if (cursorId) dirty.add(cursorId);
    for (const lineId of prevSelected) {
      if (!nextSelected.has(lineId)) dirty.add(lineId);
    }
    for (const lineId of nextSelected) {
      if (!prevSelected.has(lineId)) dirty.add(lineId);
    }
    return dirty;
  };

  const rebuildSelected = () => {
    const next = new Set<string>();
    if (store.visualAnchorId && store.cursorId) {
      const range = rangeBetween(lines, store.visualAnchorId, store.cursorId);
      if (range) {
        for (const line of lines) {
          if (lineInRange(line, range)) next.add(line.id);
        }
      }
    }
    selected = next;
  };

  const commitCursor = (id: string | null, align: ScrollAlign) => {
    const prevCursor = store.cursorId;
    const prevSelected = selected;
    store.cursorId = id;
    if (store.visualAnchorId) rebuildSelected();
    store.scrollAlign = align;
    store.scrollSeq += 1;
    const dirty = new Set<string>();
    if (prevCursor) dirty.add(prevCursor);
    if (id) dirty.add(id);
    if (prevSelected !== selected) {
      for (const lineId of prevSelected) {
        if (!selected.has(lineId)) dirty.add(lineId);
      }
      for (const lineId of selected) {
        if (!prevSelected.has(lineId)) dirty.add(lineId);
      }
    }
    emitIds(dirty);
    emitScroll();
  };

  const store = {
    cursorId: null as string | null,
    visualAnchorId: null as string | null,
    scrollAlign: "nearest" as ScrollAlign,
    /** Viewport offset, in px, used when `scrollAlign` is `pin`. */
    scrollPin: 0,
    scrollSeq: 0,
    selectableIds: [] as string[],

    /** Stable per line id so a row subscribes once, not on every parent render. */
    subscribeFor(id: string): (listener: () => void) => () => void {
      const existing = subscribeFns.get(id);
      if (existing) return existing;
      const subscribe = (listener: () => void) => {
        let bucket = listeners.get(id);
        if (!bucket) {
          bucket = new Set();
          listeners.set(id, bucket);
        }
        const active = bucket;
        active.add(listener);
        return () => {
          active.delete(listener);
          if (active.size === 0) listeners.delete(id);
        };
      };
      subscribeFns.set(id, subscribe);
      return subscribe;
    },

    subscribeScroll(listener: () => void) {
      scrollListeners.add(listener);
      return () => {
        scrollListeners.delete(listener);
      };
    },

    mark(id: string): LineMark {
      const cursor = store.cursorId === id;
      const isSelected = selected.has(id);
      if (!cursor && !isSelected) return IDLE_MARK;
      const prev = marks.get(id);
      if (prev && prev.cursor === cursor && prev.selected === isSelected) return prev;
      const next = { cursor, selected: isSelected };
      marks.set(id, next);
      return next;
    },

    syncLines(nextLines: readonly DisplayLine[]) {
      if (lines === nextLines) return;
      lines = nextLines;
      store.selectableIds = [];
      indexById = new Map();
      for (const line of nextLines) {
        if (!isSelectableLine(line)) continue;
        indexById.set(line.id, store.selectableIds.length);
        store.selectableIds.push(line.id);
      }
      const prevCursor = store.cursorId;
      const prevSelected = selected;
      if (store.cursorId != null && !indexById.has(store.cursorId)) store.cursorId = null;
      if (
        store.visualAnchorId != null &&
        !nextLines.some((line) => line.id === store.visualAnchorId)
      ) {
        store.visualAnchorId = null;
      }
      if (store.visualAnchorId) rebuildSelected();
      else if (selected.size > 0) selected = new Set();
      const dirty = diffIds(prevSelected, selected, null);
      if (prevCursor && prevCursor !== store.cursorId) dirty.add(prevCursor);
      if (store.cursorId && prevCursor !== store.cursorId) dirty.add(store.cursorId);
      if (dirty.size > 0) emitIds(dirty);
    },

    reset() {
      const dirty = store.cursorId != null || store.visualAnchorId != null || selected.size > 0;
      store.cursorId = null;
      store.visualAnchorId = null;
      selected = new Set();
      marks.clear();
      store.scrollAlign = "nearest";
      store.scrollPin = 0;
      if (dirty) emitAll();
    },

    currentId(): string | null {
      if (store.cursorId != null && indexById.has(store.cursorId)) return store.cursorId;
      return store.selectableIds[0] ?? null;
    },

    move(delta: number) {
      const ids = store.selectableIds;
      if (ids.length === 0) return;
      const index = store.cursorId != null ? indexById.get(store.cursorId) : undefined;
      const from = index == null ? 0 : index;
      const next = Math.min(ids.length - 1, Math.max(0, from + delta));
      commitCursor(ids[next]!, "nearest");
    },

    jump(edge: "start" | "end") {
      const ids = store.selectableIds;
      if (ids.length === 0) return;
      const id = edge === "start" ? ids[0]! : ids[ids.length - 1]!;
      commitCursor(id, edge);
    },

    /** Moves the marker to `id` and keeps it `pin` pixels below the viewport top. */
    placePinned(id: string, pin: number) {
      store.scrollPin = pin;
      commitCursor(id, "pin");
    },

    focusLine(id: string) {
      const prevSelected = selected;
      store.visualAnchorId = null;
      selected = new Set();
      commitCursor(id, "nearest");
      if (prevSelected.size > 0) emitIds(prevSelected);
    },

    toggleVisual() {
      if (store.visualAnchorId) {
        store.clearVisual();
        return;
      }
      const id = store.currentId();
      if (!id) return;
      const prevCursor = store.cursorId;
      store.cursorId = id;
      store.visualAnchorId = id;
      rebuildSelected();
      store.scrollAlign = "nearest";
      store.scrollSeq += 1;
      const dirty = new Set<string>(selected);
      if (prevCursor) dirty.add(prevCursor);
      emitIds(dirty);
      emitScroll();
    },

    clearVisual() {
      if (!store.visualAnchorId && selected.size === 0) return;
      const prevSelected = selected;
      store.visualAnchorId = null;
      selected = new Set();
      emitIds(prevSelected);
    },
  };
  return store;
}

type LineCursorStore = ReturnType<typeof createLineCursorStore>;

type ScrollEl = {
  getBoundingClientRect?: () => { top: number; bottom: number };
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  parentElement?: ScrollEl | null;
  scrollIntoView?: (options: { block: ScrollAlign }) => void;
};

function findVerticalScroller(el: ScrollEl): ScrollEl | null {
  const getStyle = (
    globalThis as { getComputedStyle?: (node: ScrollEl) => { overflowY?: string } }
  ).getComputedStyle;
  let parent = el.parentElement ?? null;
  while (parent) {
    const overflowY = getStyle?.(parent).overflowY ?? "";
    const height = parent.clientHeight ?? 0;
    const scrollHeight = parent.scrollHeight ?? 0;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      scrollHeight > height + 1
    ) {
      return parent;
    }
    parent = parent.parentElement ?? null;
  }
  return null;
}

/** Scrolls one row inside the diff pane. Skips the layout read when it is already visible. */
function scrollLineIntoView(node: object, align: ScrollAlign, pin = 0) {
  const el = node as ScrollEl;
  if (typeof el.getBoundingClientRect !== "function") return;
  const scroller = findVerticalScroller(el);
  if (
    !scroller ||
    typeof scroller.getBoundingClientRect !== "function" ||
    typeof scroller.scrollTop !== "number"
  ) {
    if (align !== "pin") el.scrollIntoView?.({ block: align });
    return;
  }
  const row = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (align === "nearest" && row.top >= view.top && row.bottom <= view.bottom) return;
  let delta = 0;
  if (align === "pin") delta = row.top - view.top - pin;
  else if (align === "start") delta = row.top - view.top;
  else if (align === "end") delta = row.bottom - view.bottom;
  else if (row.top < view.top) delta = row.top - view.top;
  else delta = row.bottom - view.bottom;
  scroller.scrollTop += delta;
}

/** Lines to jump when the diff pane has not been measured yet. */
const PAGE_FALLBACK_LINES = 20;

/**
 * Pages the line marker by about one viewport, keeping two lines of overlap
 * and the marker's place on screen (vim Ctrl-F / Ctrl-B).
 */
function pageCursor(
  store: LineCursorStore,
  rowNodes: Map<string, RowNode>,
  direction: 1 | -1,
) {
  const ids = store.selectableIds;
  if (ids.length === 0) return;
  const currentId = store.currentId();
  if (!currentId) return;
  const start = ids.indexOf(currentId);
  const from = start < 0 ? 0 : start;
  const fallback = () => {
    store.move(direction * Math.min(PAGE_FALLBACK_LINES, ids.length - 1));
  };

  const node = rowNodes.get(ids[from]!) as ScrollEl | undefined;
  if (!node || typeof node.getBoundingClientRect !== "function") {
    fallback();
    return;
  }
  const scroller = findVerticalScroller(node);
  if (
    !scroller ||
    typeof scroller.getBoundingClientRect !== "function" ||
    typeof scroller.clientHeight !== "number"
  ) {
    fallback();
    return;
  }
  const row = node.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const lineHeight = Math.max(1, row.bottom - row.top);
  const viewHeight = scroller.clientHeight > 0 ? scroller.clientHeight : view.bottom - view.top;
  if (viewHeight <= 0) {
    fallback();
    return;
  }
  const overlap = Math.min(lineHeight * 2, viewHeight / 2);
  const pagePx = Math.max(lineHeight, viewHeight - overlap);
  const pin = Math.min(Math.max(0, row.top - view.top), Math.max(0, viewHeight - lineHeight));

  let next = from;
  for (let step = from + direction; step >= 0 && step < ids.length; step += direction) {
    const candidate = rowNodes.get(ids[step]!) as ScrollEl | undefined;
    if (!candidate || typeof candidate.getBoundingClientRect !== "function") break;
    next = step;
    if (Math.abs(candidate.getBoundingClientRect().top - row.top) >= pagePx) break;
  }
  store.placePinned(ids[next]!, pin);
}

/** useSyncExternalStore misbehaves under Hermes-evaluated plugin bundles; subscribe in an effect instead. */
function useLineMark(store: LineCursorStore, id: string, enabled: boolean): LineMark {
  const [mark, setMark] = useState<LineMark>(() => (enabled ? store.mark(id) : IDLE_MARK));
  useEffect(() => {
    if (!enabled) return;
    setMark(store.mark(id));
    return store.subscribeFor(id)(() => {
      setMark(store.mark(id));
    });
  }, [enabled, id, store]);
  return enabled ? mark : IDLE_MARK;
}

function useScrollSeq(store: LineCursorStore, enabled: boolean): number {
  const [seq, setSeq] = useState(() => (enabled ? store.scrollSeq : 0));
  useEffect(() => {
    if (!enabled) return;
    setSeq(store.scrollSeq);
    return store.subscribeScroll(() => {
      setSeq(store.scrollSeq);
    });
  }, [enabled, store]);
  return enabled ? seq : 0;
}

function CursorFollow({
  store,
  rowNodes,
}: {
  store: LineCursorStore;
  rowNodes: { current: Map<string, RowNode> };
}) {
  const seq = useScrollSeq(store, true);
  useLayoutEffect(() => {
    if (seq === 0) return;
    const id = store.cursorId;
    if (!id) return;
    const node = rowNodes.current.get(id);
    if (node) scrollLineIntoView(node, store.scrollAlign, store.scrollPin);
  }, [rowNodes, seq, store]);
  return null;
}

function WebDiffLineRow({
  line,
  theme,
  palette,
  typography,
  selected,
  store,
  rowRef,
  platform,
  onPressLine,
  onDragEnterLine,
  onDragStartLine,
  onDragEndLine,
}: {
  line: DisplayLine;
  theme: Theme;
  palette: ReturnType<typeof diffPalette>;
  typography: DiffTypography;
  selected: boolean;
  store: LineCursorStore;
  rowRef(node: RowNode | null): void;
  platform: "ios" | "android" | "web";
  onPressLine(side: "old" | "new", lineNumber: number, id: string): void;
  onDragEnterLine(side: "old" | "new", lineNumber: number): void;
  onDragStartLine(side: "old" | "new", lineNumber: number, id: string): void;
  onDragEndLine(): void;
}) {
  const mark = useLineMark(store, line.id, platform === "web");
  const side = lineSide(line);
  const lineNumber = side ? lineNumberForSide(line, side) : null;

  return (
    <DiffLineRow
      line={line}
      lineId={line.id}
      theme={theme}
      palette={palette}
      typography={typography}
      selected={selected || mark.selected}
      cursor={mark.cursor}
      platform={platform}
      rowRef={rowRef}
      onPress={
        side && lineNumber != null
          ? () => onPressLine(side, lineNumber, line.id)
          : undefined
      }
      onDragStartLine={onDragStartLine}
      onDragEnterLine={onDragEnterLine}
      onDragEndLine={onDragEndLine}
    />
  );
}

export function DiffView(props: DiffViewProps) {
  if (props.platform !== "web") {
    return <NativeDiffView {...props} />;
  }
  return <WebDiffView {...props} />;
}

function WebDiffView({
  pathKey,
  displayPath,
  file,
  cwd,
  status,
  hunks,
  error,
  progress,
  typography,
  theme,
  compact,
  platform,
  canViewFile,
  keyboardEnabled,
  panelActions,
  onToggleViewed,
  onIgnore,
  onViewFile,
  onDiscardFile,
  onChangeFileComment,
  onSaveLineComment,
  onDeleteLineComment,
}: DiffViewProps) {
  const toast = useToast();
  const palette = useMemo(() => diffPalette(theme), [theme]);
  const { lines, gapByBefore, totalLines, expandingKey, onExpand } = useDiffExpand({
    cwd,
    pathKey,
    file,
    hunks,
  });
  const dragging = useRef<{
    side: "old" | "new";
    startLine: number;
    moved: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<LineDraftRange | null>(null);
  const draftBodyRef = useRef("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentRef = useRef<View>(null);
  const composerRef = useRef<View>(null);
  const assignComposerRef = useCallback((node: View | null) => {
    composerRef.current = node;
  }, []);
  const composerScrollKey = useMemo(() => {
    if (draft) {
      const end = Math.max(draft.startLine, draft.endLine);
      return `draft:${draft.side}:${end}`;
    }
    if (editingKey) return `edit:${editingKey}`;
    return null;
  }, [draft, editingKey]);
  const composerActive = composerScrollKey != null;
  useScrollComposerIntoView(scrollRef, contentRef, composerRef, composerScrollKey);
  const [fileCommentOpen, setFileCommentOpen] = useState(false);
  const cursorStoreRef = useRef<LineCursorStore | null>(null);
  if (cursorStoreRef.current == null) cursorStoreRef.current = createLineCursorStore();
  const cursorStore = cursorStoreRef.current;
  const rowNodes = useRef(new Map<string, RowNode>());
  const rowRefCallbacks = useRef(new Map<string, (node: RowNode | null) => void>());
  const pendingKeyRef = useRef<"g" | null>(null);

  useEffect(() => {
    setDraft(null);
    draftBodyRef.current = "";
    setEditingKey(null);
    setFileCommentOpen(false);
    cursorStore.reset();
    pendingKeyRef.current = null;
    rowNodes.current.clear();
    rowRefCallbacks.current.clear();
    dragging.current = null;
  }, [cursorStore, pathKey]);

  useLayoutEffect(() => {
    cursorStore.syncLines(lines);
  }, [cursorStore, lines]);

  const styles = useMemo(
    () => diffViewFrameStyles(theme, composerActive),
    [composerActive, theme],
  );

  const onDragStartLine = useCallback(
    (side: "old" | "new", line: number, id: string) => {
      dragging.current = { side, startLine: line, moved: false };
      setEditingKey(null);
      cursorStore.focusLine(id);
    },
    [cursorStore],
  );

  const onDragEnterLine = useCallback((side: "old" | "new", line: number) => {
    const active = dragging.current;
    if (!active || active.side !== side) return;
    if (line === active.startLine) return;
    active.moved = true;
    setDraft((current) => {
      if (current?.side !== side) draftBodyRef.current = "";
      return {
        side,
        startLine: Math.min(active.startLine, line),
        endLine: Math.max(active.startLine, line),
      };
    });
  }, []);

  const applyTapSelection = useCallback((side: "old" | "new", line: number) => {
    setDraft((current) => {
      if (!current || current.side !== side) {
        draftBodyRef.current = "";
        return { side, startLine: line, endLine: line };
      }
      const lo = Math.min(current.startLine, current.endLine);
      const hi = Math.max(current.startLine, current.endLine);
      // Same single line: keep (confirmed). Outside range with empty body: restart.
      if (lo === hi && lo === line) return current;
      if ((line < lo || line > hi) && !draftBodyRef.current.trim()) {
        draftBodyRef.current = "";
        return { side, startLine: line, endLine: line };
      }
      return {
        side,
        startLine: Math.min(lo, line),
        endLine: Math.max(hi, line),
      };
    });
    setEditingKey(null);
  }, []);

  const onDragEndLine = useCallback(() => {
    const active = dragging.current;
    if (!active) return;
    if (!active.moved) applyTapSelection(active.side, active.startLine);
    dragging.current = null;
  }, [applyTapSelection]);

  useEffect(() => {
    if (platform !== "web") return;
    const doc = (
      globalThis as { document?: { addEventListener: Function; removeEventListener: Function } }
    ).document;
    if (!doc) return;
    const onWindowMouseUp = () => {
      if (dragging.current) onDragEndLine();
    };
    doc.addEventListener("mouseup", onWindowMouseUp);
    return () => doc.removeEventListener("mouseup", onWindowMouseUp);
  }, [onDragEndLine, platform]);

  const onPressLine = useCallback(
    (side: "old" | "new", line: number, id: string) => {
      applyTapSelection(side, line);
      cursorStore.focusLine(id);
    },
    [applyTapSelection, cursorStore],
  );

  const saveDraft = useCallback(
    async (body: string) => {
      const current = draftRef.current;
      const trimmed = body.trim();
      if (!current || !trimmed) return;
      const ok = await onSaveLineComment({
        side: current.side,
        startLine: Math.min(current.startLine, current.endLine),
        endLine: Math.max(current.startLine, current.endLine),
        body: trimmed,
      });
      if (ok) {
        draftBodyRef.current = "";
        setDraft(null);
      } else toast.error("Could not save comment");
    },
    [onSaveLineComment, toast],
  );
  const cancelDraft = useCallback(() => {
    draftBodyRef.current = "";
    setDraft(null);
  }, []);

  const startEditComment = useCallback((comment: LineComment) => {
    setEditingKey(commentKey(comment));
    draftBodyRef.current = "";
    setDraft(null);
  }, []);
  const saveEditComment = useCallback(
    async (comment: LineComment, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) {
        toast.error("Comment body is empty — use Delete to remove it");
        return;
      }
      const ok = await onSaveLineComment({ ...comment, body: trimmed });
      if (ok) setEditingKey(null);
      else toast.error("Could not save comment");
    },
    [onSaveLineComment, toast],
  );
  const cancelEditComment = useCallback(() => setEditingKey(null), []);
  const deleteComment = useCallback(
    async (comment: LineComment) => {
      const ok = await onDeleteLineComment(comment);
      if (ok) setEditingKey(null);
      else toast.error("Could not delete comment");
    },
    [onDeleteLineComment, toast],
  );

  const openComposer = useCallback(
    (range: LineRange) => {
      const existing = progress.lineComments.find(
        (comment) => commentKey(comment) === commentKey(range),
      );
      if (existing) {
        startEditComment(existing);
        return;
      }
      setEditingKey(null);
      draftBodyRef.current = "";
      setDraft(range);
    },
    [progress.lineComments, startEditComment],
  );

  const rowRefFor = useCallback((id: string) => {
    const existing = rowRefCallbacks.current.get(id);
    if (existing) return existing;
    const callback = (node: RowNode | null) => {
      if (node) rowNodes.current.set(id, node);
      else rowNodes.current.delete(id);
    };
    rowRefCallbacks.current.set(id, callback);
    return callback;
  }, []);

  const runAction = (action: ReviewKeyAction): boolean => {
    cursorStore.syncLines(lines);
    switch (action) {
      case "cursorDown":
      case "cursorUp":
        cursorStore.move(action === "cursorDown" ? 1 : -1);
        return true;
      case "pageDown":
      case "pageUp":
        pageCursor(cursorStore, rowNodes.current, action === "pageDown" ? 1 : -1);
        return true;
      case "cursorTop":
        cursorStore.jump("start");
        return true;
      case "cursorBottom":
        cursorStore.jump("end");
        return true;
      case "toggleVisual":
        cursorStore.toggleVisual();
        return true;
      case "lineComment": {
        if (cursorStore.visualAnchorId) {
          const anchor = cursorStore.visualAnchorId;
          const current = cursorStore.cursorId;
          const range = current ? rangeBetween(lines, anchor, current) : null;
          cursorStore.clearVisual();
          if (range) openComposer(range);
          return true;
        }
        const current = cursorStore.currentId();
        if (!current) return true;
        if (cursorStore.cursorId !== current) cursorStore.focusLine(current);
        const range = rangeBetween(lines, current, current);
        if (range) openComposer(range);
        return true;
      }
      case "fileComment":
        setFileCommentOpen(true);
        return true;
      case "markRead":
        onToggleViewed();
        return true;
      case "ignore":
        onIgnore();
        return true;
      case "escape":
        return false;
    }
  };

  // Returns true when the key was handled (the caller then prevents default).
  // `chord` is a modifier shortcut (Ctrl+F / Ctrl+B) already resolved by the caller.
  const handleKey = (key: string | undefined, chord: ReviewKeyAction | null = null): boolean => {
    if (chord) {
      pendingKeyRef.current = null;
      if (!keyboardEnabled || draft || editingKey || fileCommentOpen) return false;
      return runAction(chord);
    }
    const parsed = nextReviewKey(pendingKeyRef.current, key);
    pendingKeyRef.current = parsed.pending;
    const action = parsed.action;
    if (action === "escape") {
      if (cursorStore.visualAnchorId) {
        cursorStore.clearVisual();
        return true;
      }
      if (draft) {
        cancelDraft();
        return true;
      }
      return false;
    }
    // Composers own the keyboard while open, so shortcuts must not fire through them.
    if (!keyboardEnabled || draft || editingKey || fileCommentOpen) {
      pendingKeyRef.current = null;
      return false;
    }
    if (!action) return parsed.pending === "g";
    return runAction(action);
  };
  // Keydown listener is attached once; it always calls the latest handler.
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  useEffect(() => {
    if (platform !== "web") return;
    const doc = webDocument();
    if (!doc) return;
    const onKeyDown = (event: WebKeyEvent) => {
      if (isEditableTarget(event.target)) {
        pendingKeyRef.current = null;
        return;
      }
      const chord = reviewModifierAction(event);
      if (chord) {
        if (handleKeyRef.current(undefined, chord)) event.preventDefault?.();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (handleKeyRef.current(event.key)) event.preventDefault?.();
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [platform]);

  const header = (
    <FileHeader
      displayPath={displayPath}
      file={file}
      progress={progress}
      theme={theme}
      compact={compact}
      platform={platform}
      canViewFile={canViewFile}
      onToggleViewed={onToggleViewed}
      onIgnore={onIgnore}
      commentOpen={fileCommentOpen}
      onCommentOpenChange={setFileCommentOpen}
      onSaveFileComment={onChangeFileComment}
      onViewFile={onViewFile}
      onDiscardFile={onDiscardFile}
      panelActions={panelActions}
    />
  );

  if (status !== "ok") {
    return (
      <View style={styles.root}>
        {header}
        <Text style={[styles.muted, { marginTop: 12 }]}>
          {diffViewStatusMessage(status, error)}
        </Text>
      </View>
    );
  }

  const selectionRange = draftSelectionRange(draft);

  return (
    <View style={styles.root}>
      {header}
      {platform === "web" ? <CursorFollow store={cursorStore} rowNodes={rowNodes} /> : null}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View ref={contentRef} collapsable={false}>
        {progress.fileComment ? (
          <Text style={styles.muted} numberOfLines={2}>
            File note: {progress.fileComment}
          </Text>
        ) : null}
        <Text style={styles.muted}>
          {platform === "web"
            ? "Click or drag to comment. Keys: j/k move · Ctrl+F/Ctrl+B page · gg/G top/bottom · c comment line · v, j/k, c comment a range · C file note · r viewed · i ignore"
            : "Tap a line to comment; tap another to set a range. Tap outside the range (empty draft) to start over."}
        </Text>

        <View style={styles.hunk}>
          {(gapByBefore.get(null) ?? []).map((gap) => (
            <ExpandGapButton
              key={gap.id}
              gap={gap}
              totalLines={totalLines}
              expandingKey={expandingKey}
              theme={theme}
              onExpand={onExpand}
            />
          ))}
          {lines.map((line) => {
            const selected = selectionRange ? lineInRange(line, selectionRange) : false;
            const comments = commentsAfterLine(line, progress.lineComments);
            const draftHere = draft != null && isDraftComposerLine(line, draft);
            return (
              <View key={line.id}>
                <WebDiffLineRow
                  line={line}
                  theme={theme}
                  palette={palette}
                  typography={typography}
                  selected={selected}
                  store={cursorStore}
                  rowRef={rowRefFor(line.id)}
                  platform={platform}
                  onPressLine={onPressLine}
                  onDragEnterLine={onDragEnterLine}
                  onDragStartLine={onDragStartLine}
                  onDragEndLine={onDragEndLine}
                />
                {comments.map((comment) => {
                  const key = commentKey(comment);
                  const editing = editingKey === key;
                  return (
                    <View
                      key={key}
                      ref={editing ? assignComposerRef : undefined}
                      collapsable={false}
                    >
                      <InlineCommentCard
                        comment={comment}
                        theme={theme}
                        editing={editing}
                        onStartEdit={startEditComment}
                        onSave={(next, body) => void saveEditComment(next, body)}
                        onCancel={cancelEditComment}
                        onDelete={(next) => void deleteComment(next)}
                      />
                    </View>
                  );
                })}
                {draftHere && draft ? (
                  <View ref={assignComposerRef} collapsable={false}>
                    <LineDraftBox
                      range={draft}
                      bodyRef={draftBodyRef}
                      theme={theme}
                      showKeyboardHint
                      onSave={saveDraft}
                      onCancel={cancelDraft}
                    />
                  </View>
                ) : null}
                {(gapByBefore.get(line.id) ?? []).map((gap) => (
                  <ExpandGapButton
                    key={gap.id}
                    gap={gap}
                    totalLines={totalLines}
                    expandingKey={expandingKey}
                    theme={theme}
                    onExpand={onExpand}
                  />
                ))}
              </View>
            );
          })}
        </View>
        </View>
      </ScrollView>
    </View>
  );
}
