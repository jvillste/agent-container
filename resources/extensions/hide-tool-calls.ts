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
import { SettingsManager } from "@earendil-works/pi-coding-agent";
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
}

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;

interface RowRenderContext {
	toolCallId: string;
	invalidate: () => void;
	state: Record<string, unknown>;
}

const GROUP_INDEX_MIN_REBUILD_INTERVAL_MS = 1000;

/**
 * Pi reloads extensions when the visibility changes, which re-evaluates this
 * module. Storing the state on `globalThis` keeps the toggle and the burst index
 * across that reload.
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

/**
 * Pi has no API for changing the `hideThinkingBlock` setting. Returning true
 * while the summary is active makes Pi treat thinking blocks as hidden; an empty
 * hidden-thinking label then makes those hidden blocks render no lines at all.
 */
function installThinkingBlockPatch(state: VisibilityState): void {
	const prototype = SettingsManager.prototype as unknown as {
		getHideThinkingBlock: () => boolean;
		__toolCallSummaryPatched?: boolean;
	};
	if (prototype.__toolCallSummaryPatched === true) {
		return;
	}
	const originalGetHideThinkingBlock = prototype.getHideThinkingBlock;
	prototype.getHideThinkingBlock = function (this: unknown): boolean {
		return state.hidden || originalGetHideThinkingBlock.call(this);
	};
	prototype.__toolCallSummaryPatched = true;
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
	state.currentBurst.invalidateLeader?.();
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
	if (leaderIsAnotherRow) {
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

export default function (pi: ExtensionAPI) {
	const state = getVisibilityState();
	installThinkingBlockPatch(state);

	const rendererResolver: ToolRendererResolver = (_toolName, next) => {
		if (!state.hidden) {
			return next();
		}
		const renderCall: CallRenderer = (_args, theme, context) => {
			const burst = assignRowToBurst(state, context);
			if (burst.leaderToolCallId !== context.toolCallId) {
				return createEmptyComponent();
			}
			return new Text(theme.fg("muted", formatSummary(burst)), 0, 0);
		};
		const renderResult: ResultRenderer = () => createEmptyComponent();
		return { renderShell: "self", renderCall, renderResult };
	};

	pi.registerToolRenderer(rendererResolver);

	// Fallback for the thinking patch above: if Pi's class identity ever changes,
	// blank thinking markdown instead of showing it.
	pi.registerMarkdownTransformer((markdown) => (state.hidden ? "" : markdown), {
		messageTypes: ["assistant-thinking"],
	});

	pi.registerCommand("tool-calls", {
		description: "Summarize or show tool call rows and thinking blocks: /tool-calls [hide|show]",
		handler: async (argument, context) => {
			if (!context.hasUI) {
				return;
			}
			const requested = argument.trim().toLowerCase();
			if (requested !== "" && requested !== "hide" && requested !== "show") {
				context.ui.notify("Usage: /tool-calls [hide|show]", "warning");
				return;
			}
			const shouldHide = requested === "" ? !state.hidden : requested === "hide";
			if (!context.isIdle()) {
				context.ui.notify("Wait for the current response to finish before changing tool call visibility", "warning");
				return;
			}
			if (shouldHide === state.hidden) {
				context.ui.notify(shouldHide ? "Tool calls are already summarized" : "Tool calls are already visible", "info");
				return;
			}
			state.hidden = shouldHide;
			// A reload is the only way to redraw existing rows with different renderers.
			await context.reload();
		},
	});

	// Shortcut handlers receive a plain ExtensionContext, which has no reload(), so
	// route the toggle through the command: its handler gets a command context that
	// can reload the extension and redraw the existing rows.
	pi.registerShortcut("ctrl+v", {
		description: "Toggle tool call summary (/tool-calls)",
		handler: () => {
			pi.sendUserMessage("/tool-calls", { expandPromptTemplates: true });
		},
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			state.currentBurst = undefined;
			resetMessageTracking(state);
			return;
		}
		if (event.message.role === "assistant") {
			resetMessageTracking(state);
		}
	});

	pi.on("message_update", (event) => {
		if (!state.hidden || event.message.role !== "assistant") {
			return;
		}
		updateStreamedMessage(state, event.message);
	});

	pi.on("message_end", (event) => {
		if (!state.hidden || event.message.role !== "assistant") {
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
		resetMessageTracking(state);
		rebuildBurstIndex(state);
		if (context.hasUI) {
			applyVisibilityStatus(context, state.hidden);
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
