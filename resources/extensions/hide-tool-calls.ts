/**
 * Tool Call Summary
 *
 * Collapses tool call rows and thinking blocks into one muted line per burst of
 * work, for example "3 tool calls · 2 thinking blocks". The line updates while
 * the model keeps going. The model still receives every tool call, result, and
 * thinking block; only the display changes.
 *
 * A burst ends when the assistant writes visible text or the user speaks, so a
 * long series of single-tool-call messages becomes one line.
 *
 * Usage:
 *   /tool-calls            toggle
 *   /tool-calls hide       collapse rows and thinking blocks
 *   /tool-calls show       restore the normal transcript
 *
 * The toggle also works while the agent is running. Existing rows are redrawn in
 * place instead of waiting for a reload.
 *
 * Keyboard shortcut: ctrl+v toggles the summary. Paste moved to alt+v in
 * keybindings.json, because extension shortcuts are dispatched before the
 * paste keybinding in the editor.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolRendererResolver,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

/** Hidden content of one burst of work; the first tool call row renders it. */
interface Burst {
	toolCalls: number;
	thinkingBlocks: number;
	leaderToolCallId?: string;
	invalidateLeader?: () => void;
}

interface VisibilityState {
	hidden: boolean;
	thinkingLabelCleared: boolean;
	burstsByToolCallId: Map<string, Burst>;
	currentBurst?: Burst;
	sessionManager?: ExtensionContext["sessionManager"];
	agentRunning: boolean;
	/** Whether the message being streamed already caused a text boundary. */
	messageBoundaryClosed: boolean;
	/** Whether the message being streamed shows text to the user. */
	messageHasVisibleText: boolean;
	/** Whether a tool call row of the message being streamed joined a burst. */
	messageJoinedBurst: boolean;
	/** Thinking blocks of the streamed message not yet added to its burst. */
	pendingThinkingBlocks: number;
	countedThinkingBlocks: number;
	lastIndexRebuildAt: number;
	/** Interactive TUI captured for redrawing existing rows without a reload. */
	tui?: unknown;
}

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type RenderTheme = Parameters<CallRenderer>[1];
type RenderContext = Parameters<CallRenderer>[2];
type ResultOptions = Parameters<ResultRenderer>[1];

interface RowRenderContext {
	toolCallId: string;
	invalidate: () => void;
	state: Record<PropertyKey, unknown>;
}

interface ToolRow {
	children: unknown[];
	contentBox: unknown;
	selfRenderContainer: unknown;
	toolCallId: string;
	toolName: string;
	toolDefinition?: { renderShell?: "default" | "self"; baseRenderShell?: "default" | "self" };
	getRenderShell?: () => "default" | "self";
	invalidate: () => void;
}

interface AssistantRow {
	hideThinkingBlock?: boolean;
	lastMessage?: unknown;
	isStreaming?: boolean;
	updateContent?: (message: unknown, isStreaming?: boolean) => void;
	setHideThinkingBlock?: (hide: boolean) => void;
	thinkingVisibilityOverrides?: { clear?: () => void };
	__toolCallSummaryOriginalHideThinkingBlock?: boolean;
	__toolCallSummaryPatched?: boolean;
}

const GROUP_INDEX_MIN_REBUILD_INTERVAL_MS = 1000;
const TUI_CAPTURE_WIDGET_KEY = "hide-tool-calls-tui-capture";
const BASE_CALL_COMPONENT = Symbol("toolCallSummaryBaseCallComponent");
const BASE_RESULT_COMPONENT = Symbol("toolCallSummaryBaseResultComponent");

/**
 * Pi re-evaluates this module on /reload. Storing the state on `globalThis` keeps
 * the toggle and the burst index across that reload.
 */
function getVisibilityState(): VisibilityState {
	const globalRecord = globalThis as typeof globalThis & { __piToolCallSummary?: VisibilityState };
	globalRecord.__piToolCallSummary ??= {
		hidden: false,
		thinkingLabelCleared: false,
		burstsByToolCallId: new Map(),
		agentRunning: false,
		messageBoundaryClosed: false,
		messageHasVisibleText: false,
		messageJoinedBurst: false,
		pendingThinkingBlocks: 0,
		countedThinkingBlocks: 0,
		lastIndexRebuildAt: 0,
	};
	return globalRecord.__piToolCallSummary;
}

function createBurst(): Burst {
	return { toolCalls: 0, thinkingBlocks: 0 };
}

/** A row without content renders to zero lines when the tool uses its own shell. */
function createEmptyComponent(): Container {
	return new Container();
}

function formatToolCallCount(count: number): string {
	return count === 1 ? "1 tool call" : `${count} tool calls`;
}

function formatThinkingBlockCount(count: number): string {
	return count === 1 ? "1 thinking block" : `${count} thinking blocks`;
}

function formatSummary(burst: Burst): string {
	const parts: string[] = [];
	if (burst.toolCalls > 0) {
		parts.push(formatToolCallCount(burst.toolCalls));
	}
	if (burst.thinkingBlocks > 0) {
		parts.push(formatThinkingBlockCount(burst.thinkingBlocks));
	}
	return parts.join(" · ");
}

function contentItemsOf(message: unknown): unknown[] | undefined {
	if (typeof message !== "object" || message === null) {
		return undefined;
	}
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content) ? content : undefined;
}

function messageHasVisibleText(message: unknown): boolean {
	const items = contentItemsOf(message);
	if (items === undefined) {
		return false;
	}
	return items.some((item) => {
		if (typeof item !== "object" || item === null) {
			return false;
		}
		const contentItem = item as { type?: unknown; text?: unknown };
		return contentItem.type === "text" && typeof contentItem.text === "string" && contentItem.text.trim() !== "";
	});
}

function countThinkingBlocks(message: unknown): number {
	const items = contentItemsOf(message);
	if (items === undefined) {
		return 0;
	}
	let count = 0;
	for (const item of items) {
		if (typeof item !== "object" || item === null) {
			continue;
		}
		const contentItem = item as { type?: unknown; thinking?: unknown };
		if (
			contentItem.type === "thinking" &&
			typeof contentItem.thinking === "string" &&
			contentItem.thinking.trim() !== ""
		) {
			count += 1;
		}
	}
	return count;
}

function toolCallIdsOfMessage(message: unknown): string[] {
	const items = contentItemsOf(message);
	if (items === undefined) {
		return [];
	}
	const toolCallIds: string[] = [];
	for (const item of items) {
		if (typeof item !== "object" || item === null) {
			continue;
		}
		const contentItem = item as { type?: unknown; id?: unknown };
		if (contentItem.type === "toolCall" && typeof contentItem.id === "string") {
			toolCallIds.push(contentItem.id);
		}
	}
	return toolCallIds;
}

function createFallbackCall(toolName: string, args: unknown, theme: RenderTheme, expanded: boolean): Text {
	const header = theme.fg("toolTitle", theme.bold(toolName));
	if (args === undefined || args === null) {
		return new Text(header, 0, 0);
	}
	const entries: Array<[string, unknown]> =
		typeof args === "object" && !Array.isArray(args)
			? Object.entries(args as Record<string, unknown>)
			: [["args", args]];
	if (entries.length === 0) {
		return new Text(header, 0, 0);
	}
	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${text.replace(/\t/g, "    ").replace(/\r/g, "").split("\n").join("\n    ")}`;
		});
		return new Text(`${header}\n${theme.fg("muted", lines.join("\n"))}`, 0, 0);
	}
	const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
	const preview = pairs.length > 100 ? `${pairs.slice(0, 97)}...` : pairs;
	return new Text(`${header} ${theme.fg("muted", preview)}`, 0, 0);
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function toolResultText(result: Parameters<ResultRenderer>[0]): string {
	return result.content
		.filter((item) => item.type === "text")
		.map((item) => stripAnsi(item.text ?? "").replace(/\r/g, ""))
		.join("\n");
}

function createFallbackResult(
	result: Parameters<ResultRenderer>[0],
	options: ResultOptions,
	theme: RenderTheme,
	context: RenderContext,
): Container | Text {
	const output = toolResultText(result);
	if (output === "") {
		return createEmptyComponent();
	}
	const lines = output.split("\n");
	const displayLines = options.expanded ? lines : lines.slice(0, 10);
	const remaining = lines.length - displayLines.length;
	let text = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${context.keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}
	return new Text(text, 0, 0);
}

/**
 * Index the bursts of an existing session so rebuilt rows (reload, resume, tree
 * navigation) know their counts and which row shows the line.
 */
function rebuildBurstIndex(state: VisibilityState): void {
	const sessionManager = state.sessionManager;
	if (sessionManager === undefined) {
		return;
	}
	const burstsByToolCallId = new Map<string, Burst>();
	let currentBurst: Burst | undefined;
	for (const entry of sessionManager.buildContextEntries()) {
		if (entry.type !== "message") {
			continue;
		}
		const message = entry.message;
		if (message.role === "user") {
			currentBurst = undefined;
			continue;
		}
		if (message.role !== "assistant") {
			continue;
		}
		if (messageHasVisibleText(message)) {
			currentBurst = undefined;
		}
		const thinkingBlocks = countThinkingBlocks(message);
		const toolCallIds = toolCallIdsOfMessage(message);
		if (thinkingBlocks === 0 && toolCallIds.length === 0) {
			continue;
		}
		currentBurst ??= createBurst();
		currentBurst.thinkingBlocks += thinkingBlocks;
		currentBurst.toolCalls += toolCallIds.length;
		if (currentBurst.leaderToolCallId === undefined && toolCallIds.length > 0) {
			currentBurst.leaderToolCallId = toolCallIds[0];
		}
		for (const toolCallId of toolCallIds) {
			burstsByToolCallId.set(toolCallId, currentBurst);
		}
	}
	state.burstsByToolCallId = burstsByToolCallId;
	state.lastIndexRebuildAt = Date.now();
}

function lookupIndexedBurst(state: VisibilityState, toolCallId: string): Burst | undefined {
	const indexedBurst = state.burstsByToolCallId.get(toolCallId);
	if (indexedBurst !== undefined) {
		return indexedBurst;
	}
	// Rows rebuilt before the index caught up: refresh it, but not for every row.
	if (Date.now() - state.lastIndexRebuildAt < GROUP_INDEX_MIN_REBUILD_INTERVAL_MS) {
		return undefined;
	}
	rebuildBurstIndex(state);
	return state.burstsByToolCallId.get(toolCallId);
}

/** Add the thinking blocks of the streamed message once its burst is known. */
function flushPendingThinkingBlocks(state: VisibilityState): void {
	if (state.pendingThinkingBlocks <= 0) {
		return;
	}
	state.currentBurst ??= createBurst();
	state.currentBurst.thinkingBlocks += state.pendingThinkingBlocks;
	state.pendingThinkingBlocks = 0;
	if (state.hidden) {
		state.currentBurst.invalidateLeader?.();
	}
}

/**
 * Join the burst of the assistant message that is currently streaming. The row
 * stores its burst before any redraw so a leader invalidation cannot re-enter
 * this function for the same row.
 */
function joinLiveBurst(state: VisibilityState, context: RowRenderContext): Burst {
	if (!state.messageJoinedBurst) {
		// A message with visible text starts a new burst; its line follows that text.
		if (state.messageHasVisibleText) {
			state.currentBurst = undefined;
		}
		state.messageJoinedBurst = true;
	}
	const burst = (state.currentBurst ??= createBurst());
	context.state.burst = burst;
	burst.toolCalls += 1;
	const leaderIsAnotherRow =
		burst.leaderToolCallId !== undefined && burst.leaderToolCallId !== context.toolCallId;
	if (burst.leaderToolCallId === undefined) {
		burst.leaderToolCallId = context.toolCallId;
		burst.invalidateLeader = context.invalidate;
	}
	if (state.pendingThinkingBlocks > 0) {
		burst.thinkingBlocks += state.pendingThinkingBlocks;
		state.pendingThinkingBlocks = 0;
	}
	if (leaderIsAnotherRow && state.hidden) {
		// The leader row renders the counts, so redraw it when the burst grows.
		burst.invalidateLeader?.();
	}
	return burst;
}

function resetMessageTracking(state: VisibilityState): void {
	state.messageBoundaryClosed = false;
	state.messageHasVisibleText = false;
	state.messageJoinedBurst = false;
	state.pendingThinkingBlocks = 0;
	state.countedThinkingBlocks = 0;
}

/**
 * Track text and thinking of the streamed message. Visible text is a burst
 * boundary; thinking is buffered until the message has a burst of its own.
 */
function updateStreamedMessage(state: VisibilityState, message: unknown): void {
	const hasVisibleText = messageHasVisibleText(message);
	state.messageHasVisibleText = hasVisibleText;
	if (hasVisibleText && !state.messageBoundaryClosed) {
		state.currentBurst = undefined;
		state.messageBoundaryClosed = true;
	}
	const thinkingBlocks = countThinkingBlocks(message);
	if (thinkingBlocks > state.countedThinkingBlocks) {
		state.pendingThinkingBlocks += thinkingBlocks - state.countedThinkingBlocks;
		state.countedThinkingBlocks = thinkingBlocks;
	}
}

function assignRowToBurst(state: VisibilityState, context: RowRenderContext): Burst {
	const existing = context.state.burst as Burst | undefined;
	if (existing !== undefined) {
		return existing;
	}
	const indexedBurst = lookupIndexedBurst(state, context.toolCallId);
	let burst: Burst;
	if (indexedBurst !== undefined) {
		burst = indexedBurst;
	} else if (state.agentRunning) {
		burst = joinLiveBurst(state, context);
	} else {
		// Unknown row outside a run: keep it out of unrelated bursts.
		burst = { toolCalls: 1, thinkingBlocks: 0, leaderToolCallId: context.toolCallId };
	}
	context.state.burst = burst;
	return burst;
}

function applyVisibilityStatus(context: ExtensionContext, hidden: boolean): void {
	context.ui.setStatus("tool-calls", hidden ? "tool calls summarized" : undefined);
}

function applyThinkingBlockVisibility(state: VisibilityState, context: ExtensionContext): void {
	if (state.hidden && !state.thinkingLabelCleared) {
		context.ui.setHiddenThinkingLabel("");
		state.thinkingLabelCleared = true;
	} else if (!state.hidden && state.thinkingLabelCleared) {
		context.ui.setHiddenThinkingLabel();
		state.thinkingLabelCleared = false;
	}
}

/**
 * The extension UI context does not expose the TUI, but a widget factory receives
 * it synchronously. Add and remove a throwaway widget to get the root component.
 */
function captureTui(context: ExtensionContext): unknown {
	let capturedTui: unknown;
	context.ui.setWidget(TUI_CAPTURE_WIDGET_KEY, (tui) => {
		capturedTui = tui;
		return new Container();
	});
	context.ui.setWidget(TUI_CAPTURE_WIDGET_KEY, undefined);
	return capturedTui;
}

function visitComponents(
	component: unknown,
	visit: (component: unknown) => void,
	visited: Set<unknown> = new Set(),
): void {
	if (typeof component !== "object" || component === null || visited.has(component)) {
		return;
	}
	visited.add(component);
	visit(component);
	const children = (component as { children?: unknown }).children;
	if (Array.isArray(children)) {
		for (const child of children) {
			visitComponents(child, visit, visited);
		}
	}
	const child = (component as { child?: unknown }).child;
	if (child !== undefined) {
		visitComponents(child, visit, visited);
	}
}

function isToolRow(component: unknown): component is ToolRow {
	if (typeof component !== "object" || component === null) {
		return false;
	}
	const candidate = component as Record<string, unknown>;
	return (
		Array.isArray(candidate.children) &&
		typeof candidate.toolCallId === "string" &&
		typeof candidate.toolName === "string" &&
		candidate.contentBox !== undefined &&
		candidate.selfRenderContainer !== undefined &&
		typeof candidate.invalidate === "function"
	);
}

function isAssistantRow(component: unknown): component is AssistantRow {
	if (typeof component !== "object" || component === null) {
		return false;
	}
	const candidate = component as Record<string, unknown>;
	return (
		typeof candidate.updateContent === "function" &&
		typeof candidate.setHideThinkingBlock === "function"
	);
}

function mountedRootsOf(tui: unknown): unknown[] {
	if (typeof tui !== "object" || tui === null) {
		return [];
	}
	const candidate = tui as {
		getMountedRoots?: () => unknown[];
		layoutRoot?: unknown;
		children?: unknown;
	};
	if (typeof candidate.getMountedRoots === "function") {
		return candidate.getMountedRoots();
	}
	const roots: unknown[] = [];
	if (candidate.layoutRoot !== undefined) {
		roots.push(candidate.layoutRoot);
	}
	if (Array.isArray(candidate.children)) {
		roots.push(...candidate.children);
	}
	return roots;
}

function collectToolRows(tui: unknown): ToolRow[] {
	const rows: ToolRow[] = [];
	const visited = new Set<unknown>();
	for (const root of mountedRootsOf(tui)) {
		visitComponents(
			root,
			(component) => {
				if (isToolRow(component)) {
					rows.push(component);
				}
			},
			visited,
		);
	}
	return rows;
}

function collectAssistantRows(tui: unknown): AssistantRow[] {
	const rows: AssistantRow[] = [];
	const visited = new Set<unknown>();
	for (const root of mountedRootsOf(tui)) {
		visitComponents(
			root,
			(component) => {
				if (isAssistantRow(component)) {
					rows.push(component);
				}
			},
			visited,
		);
	}
	return rows;
}

/**
 * A row keeps the shell container it was built with. Swap that container when the
 * visibility changes so existing rows redraw with the same framing as new ones.
 */
function applyToolRowShells(tui: unknown, state: VisibilityState): void {
	for (const row of collectToolRows(tui)) {
		const shell =
			typeof row.getRenderShell === "function"
				? row.getRenderShell()
				: state.hidden
					? "self"
					: (row.toolDefinition?.baseRenderShell ?? "default");
		const desired = shell === "self" ? row.selfRenderContainer : row.contentBox;
		const other = shell === "self" ? row.contentBox : row.selfRenderContainer;
		const children = row.children;
		const otherIndex = children.indexOf(other);
		if (otherIndex !== -1) {
			children.splice(otherIndex, 1);
			if (!children.includes(desired)) {
				children.splice(otherIndex, 0, desired);
			}
		} else if (!children.includes(desired)) {
			// Keep the row's leading spacer first and its images after the shell.
			const insertIndex = children.length > 0 ? 1 : 0;
			children.splice(insertIndex, 0, desired);
		}
		row.invalidate();
	}
}

/**
 * Remember the user's own thinking-block setting before forcing the summary
 * state, so showing the transcript again restores that setting.
 */
function installAssistantRowOverride(row: AssistantRow, state: VisibilityState): void {
	if (row.__toolCallSummaryPatched === true) {
		return;
	}
	row.__toolCallSummaryOriginalHideThinkingBlock = row.hideThinkingBlock ?? false;
	const originalSetHideThinkingBlock = row.setHideThinkingBlock;
	if (originalSetHideThinkingBlock !== undefined) {
		row.setHideThinkingBlock = function (this: AssistantRow, hide: boolean): void {
			this.__toolCallSummaryOriginalHideThinkingBlock = hide;
			originalSetHideThinkingBlock.call(this, state.hidden || hide);
		};
	}
	row.__toolCallSummaryPatched = true;
}

function applyThinkingVisibilityToRows(tui: unknown, state: VisibilityState): AssistantRow[] {
	const changedRows: AssistantRow[] = [];
	for (const row of collectAssistantRows(tui)) {
		installAssistantRowOverride(row, state);
		const original = row.__toolCallSummaryOriginalHideThinkingBlock ?? row.hideThinkingBlock ?? false;
		const desired = state.hidden || original;
		const changed = row.hideThinkingBlock !== desired;
		row.hideThinkingBlock = desired;
		if (state.hidden) {
			// A click on a thinking block must not reveal it while the summary is active.
			row.thinkingVisibilityOverrides?.clear?.();
		}
		if (changed) {
			changedRows.push(row);
		}
	}
	return changedRows;
}

function refreshAssistantRows(rows: AssistantRow[]): void {
	for (const row of rows) {
		if (row.lastMessage !== undefined && row.updateContent !== undefined) {
			row.updateContent(row.lastMessage, row.isStreaming);
		}
	}
}

export default function (pi: ExtensionAPI) {
	const state = getVisibilityState();

	const rendererResolver: ToolRendererResolver = (toolName, next) => {
		const base = next();
		const baseRenderShell = base?.renderShell ?? "default";
		const renderCall: CallRenderer = (args, theme, context) => {
			// Track bursts even while the transcript is visible so the counts are
			// ready when the user hides the rows mid-run.
			const burst = assignRowToBurst(state, context);
			if (state.hidden) {
				if (burst.leaderToolCallId !== context.toolCallId) {
					return createEmptyComponent();
				}
				return new Text(theme.fg("muted", formatSummary(burst)), 0, 0);
			}
			if (base?.renderCall !== undefined) {
				const baseContext = { ...context, lastComponent: context.state[BASE_CALL_COMPONENT] };
				const component = base.renderCall(args, theme, baseContext);
				context.state[BASE_CALL_COMPONENT] = component;
				return component;
			}
			return createFallbackCall(toolName, args, theme, context.expanded);
		};
		const renderResult: ResultRenderer = (result, options, theme, context) => {
			if (state.hidden) {
				return createEmptyComponent();
			}
			if (base?.renderResult !== undefined) {
				const baseContext = { ...context, lastComponent: context.state[BASE_RESULT_COMPONENT] };
				const component = base.renderResult(result, options, theme, baseContext);
				context.state[BASE_RESULT_COMPONENT] = component;
				return component;
			}
			return createFallbackResult(result, options, theme, context);
		};
		const renderers: ToolRenderers & { baseRenderShell: "default" | "self" } = {
			baseRenderShell,
			get renderShell() {
				return state.hidden || baseRenderShell === "self" ? "self" : "default";
			},
			renderCall,
			renderResult,
		};
		return renderers;
	};

	pi.registerToolRenderer(rendererResolver);

	// Blank thinking markdown while the summary is active. This works for both
	// existing and newly created message components.
	pi.registerMarkdownTransformer((markdown) => (state.hidden ? "" : markdown), {
		messageTypes: ["assistant-thinking"],
	});

	const applyRequestedVisibility = async (
		argument: string,
		context: ExtensionContext,
		reload?: () => Promise<void>,
	): Promise<void> => {
		if (!context.hasUI) {
			return;
		}
		const requested = argument.trim().toLowerCase();
		if (requested !== "" && requested !== "hide" && requested !== "show") {
			context.ui.notify("Usage: /tool-calls [hide|show]", "warning");
			return;
		}
		const shouldHide = requested === "" ? !state.hidden : requested === "hide";
		if (shouldHide === state.hidden) {
			context.ui.notify(shouldHide ? "Tool calls are already summarized" : "Tool calls are already visible", "info");
			return;
		}
		if (context.mode !== "tui") {
			if (!context.isIdle()) {
				context.ui.notify("Wait for the current response to finish before changing tool call visibility", "warning");
				return;
			}
			if (reload === undefined) {
				context.ui.notify("Could not update tool call visibility", "warning");
				return;
			}
			state.hidden = shouldHide;
			await reload();
			return;
		}
		let tui: unknown;
		try {
			tui = captureTui(context);
		} catch {
			tui = undefined;
		}
		if (tui === undefined) {
			if (context.isIdle() && reload !== undefined) {
				state.hidden = shouldHide;
				await reload();
				return;
			}
			context.ui.notify("Could not update tool call visibility", "warning");
			return;
		}
		state.tui = tui;
		state.hidden = shouldHide;
		applyVisibilityStatus(context, state.hidden);
		applyThinkingVisibilityToRows(tui, state);
		applyThinkingBlockVisibility(state, context);
		applyToolRowShells(tui, state);
	};

	pi.registerCommand("tool-calls", {
		description: "Summarize or show tool call rows and thinking blocks: /tool-calls [hide|show]",
		handler: async (argument, context) => {
			await applyRequestedVisibility(argument, context, () => context.reload());
		},
	});

	// Shortcut handlers receive a plain ExtensionContext, which is enough for the
	// in-place redraw used in the TUI. Toggle directly so it also works mid-run.
	pi.registerShortcut("ctrl+v", {
		description: "Toggle tool call summary (/tool-calls)",
		handler: async (context) => {
			await applyRequestedVisibility("", context);
		},
	});

	pi.on("message_start", (event, context) => {
		if (event.message.role === "user") {
			state.currentBurst = undefined;
			resetMessageTracking(state);
			return;
		}
		if (event.message.role === "assistant") {
			resetMessageTracking(state);
			if (state.hidden && context.mode === "tui") {
				// Let the interactive mode create its streaming component first.
				setTimeout(() => {
					try {
						if (!state.hidden) {
							return;
						}
						const tui = state.tui ?? captureTui(context);
						if (tui === undefined) {
							return;
						}
						state.tui = tui;
						refreshAssistantRows(applyThinkingVisibilityToRows(tui, state));
					} catch {
						// The session may have been replaced before the timeout ran.
					}
				}, 0);
			}
		}
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") {
			return;
		}
		updateStreamedMessage(state, event.message);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") {
			return;
		}
		updateStreamedMessage(state, event.message);
		// Thinking of a message without text or tool calls belongs to the open burst.
		if (toolCallIdsOfMessage(event.message).length === 0 && !state.messageHasVisibleText) {
			flushPendingThinkingBlocks(state);
		}
	});

	pi.on("agent_start", () => {
		state.agentRunning = true;
		state.currentBurst = undefined;
		resetMessageTracking(state);
	});

	pi.on("agent_end", () => {
		state.agentRunning = false;
	});

	pi.on("turn_end", () => {
		// Register the finished message so a later reload or tree jump can rebuild its row.
		rebuildBurstIndex(state);
	});

	pi.on("session_start", (_event, context) => {
		state.sessionManager = context.sessionManager;
		state.currentBurst = undefined;
		state.agentRunning = false;
		state.tui = undefined;
		resetMessageTracking(state);
		rebuildBurstIndex(state);
		if (context.hasUI) {
			applyVisibilityStatus(context, state.hidden);
			// The new interactive mode starts with its default hidden-thinking label.
			state.thinkingLabelCleared = false;
			applyThinkingBlockVisibility(state, context);
		}
	});

	pi.on("session_tree", (_event, context) => {
		state.sessionManager = context.sessionManager;
		state.currentBurst = undefined;
		rebuildBurstIndex(state);
	});

	pi.on("session_compact", () => {
		rebuildBurstIndex(state);
	});
}
