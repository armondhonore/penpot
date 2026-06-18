import "./style.css";
import { computeReconnectDelay } from "./ReconnectPolicy";

/**
 * the maximum allowed size for task responses sent back to the MCP server in the integrated remote MCP mode.
 * This bounds the JSON response size.
 * Note that in the remote MCP case, responses are transferred to LLMs (not the file system) and LLMs have
 * size limitations. This serves to bound the size of returned images in particular.
 * Too many overly large simultaneous responses can cause OOM issues in the MCP server, so this contributes
 * to bounding memory usage in the centrally provided MCP server.
 */
const MAX_TASK_RESPONSE_SIZE_REMOTE_MCP = 15_000_000;

// get the current theme from the URL
const searchParams = new URLSearchParams(window.location.hash.split("?")[1]);
document.body.dataset.theme = searchParams.get("theme") ?? "light";

// WebSocket connection to the MCP server
let ws: WebSocket | null = null;

/**
 * interval, in milliseconds, between application-level heartbeats sent to the MCP server.
 *
 * Unlike protocol-level WebSocket ping/pong (which the browser's network stack answers
 * automatically, even while the tab's JavaScript is frozen), this heartbeat is emitted from
 * the page's event loop. Its *absence* therefore tells the server that the tab has been
 * throttled/frozen/discarded by the browser, so the server can fail fast instead of letting
 * tasks hang until they time out.
 */
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * whether the plugin should actively maintain (and, on loss, re-establish) the connection.
 * Set when a connection is requested and cleared on an intentional disconnect, so that
 * deliberate disconnects do not trigger automatic reconnection.
 */
let shouldReconnect = false;

/** the base URL last used to connect, retained so reconnection can reuse it. */
let lastConnectionUrl: string | undefined;

/** the access token last used to connect, retained so reconnection can reuse it. */
let lastConnectionToken: string | undefined;

/** number of consecutive reconnection attempts, used to compute the backoff delay. */
let reconnectAttempts = 0;

/** handle of the pending reconnection timer, or null when none is scheduled. */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** handle of the heartbeat interval, or null when no connection is being kept alive. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * indicates whether the plugin is running with the Penpot-integrated remote MCP server enabled
 * (as opposed to a local server used with the explicitly loaded plugin);
 * set via the "mcp-mode" message sent by plugin.ts on initialization
 */
let isIntegratedRemoteMcp = false;

const statusPill = document.getElementById("connection-status") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const currentTaskEl = document.getElementById("current-task") as HTMLElement;
const executedCodeEl = document.getElementById("executed-code") as HTMLTextAreaElement;
const copyCodeBtn = document.getElementById("copy-code-btn") as HTMLButtonElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const versionWarningEl = document.getElementById("version-warning") as HTMLElement;
const versionWarningTextEl = document.getElementById("version-warning-text") as HTMLElement;

/**
 * Updates the status pill and button visibility based on connection state.
 *
 * @param code - the connection state code ("idle" | "connecting" | "connected" | "disconnected" | "error")
 * @param label - human-readable label to display inside the pill
 */
function updateConnectionStatus(code: string, label: string): void {
    if (statusPill) {
        statusPill.dataset.status = code;
    }
    if (statusText) {
        statusText.textContent = label;
    }

    const isConnected = code === "connected";
    if (connectBtn) connectBtn.hidden = isConnected;
    if (disconnectBtn) disconnectBtn.hidden = !isConnected;

    parent.postMessage(
        {
            type: "update-connection-status",
            status: code,
        },
        "*"
    );
}

/**
 * Updates the "Current task" display with the currently executing task name.
 *
 * @param taskName - the task name to display, or null to reset to "---"
 */
function updateCurrentTask(taskName: string | null): void {
    if (currentTaskEl) {
        currentTaskEl.textContent = taskName ?? "---";
    }
    if (taskName === null) {
        updateExecutedCode(null);
    }
}

/**
 * Updates the executed code textarea with the last code run during task execution.
 *
 * @param code - the code string to display, or null to clear
 */
function updateExecutedCode(code: string | null): void {
    if (executedCodeEl) {
        executedCodeEl.value = code ?? "";
    }
    if (copyCodeBtn) {
        copyCodeBtn.disabled = !code;
    }
}

/**
 * Sends a task response back to the MCP server via WebSocket.
 *
 * @param response - The response containing task ID and result
 */
function sendTaskResponse(response: any): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        let responseString = JSON.stringify(response);
        if (isIntegratedRemoteMcp && responseString.length > MAX_TASK_RESPONSE_SIZE_REMOTE_MCP) {
            const errorMessage = `Serialised response size (${responseString.length}) exceeds maximum of ${MAX_TASK_RESPONSE_SIZE_REMOTE_MCP}.`;
            console.warn(
                errorMessage +
                    " [integrated remote MCP mode restriction]; sending error response instead; original response:",
                response
            );
            response = {
                id: response.id,
                success: false,
                error: errorMessage,
            };
            responseString = JSON.stringify(response);
        }
        ws.send(responseString);
        console.log("Sent response to MCP server:", response);
    } else {
        console.error("WebSocket not connected, cannot send response");
    }
}

/**
 * Sends a single application-level heartbeat to the MCP server, if the socket is open.
 *
 * @returns true if a heartbeat was sent, false if the socket was not open
 */
function sendHeartbeat(): boolean {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
        return true;
    }
    return false;
}

/**
 * (Re)starts the periodic heartbeat. Any previously running heartbeat is cleared first,
 * so this is safe to call repeatedly (e.g. on every successful connection).
 */
function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

/** Stops the periodic heartbeat, if running. */
function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

/**
 * Schedules a reconnection attempt using exponential backoff, unless reconnection is
 * disabled or an attempt is already pending. Each call increases the backoff delay up to
 * {@link RECONNECT_MAX_DELAY_MS}; the counter is reset on a successful connection.
 */
function scheduleReconnect(): void {
    if (!shouldReconnect || reconnectTimer !== null) {
        return;
    }
    const delay = computeReconnectDelay(reconnectAttempts);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (shouldReconnect && ws?.readyState !== WebSocket.OPEN && ws?.readyState !== WebSocket.CONNECTING) {
            connectToMcpServer(lastConnectionUrl, lastConnectionToken);
        }
    }, delay);
}

/** Cancels any pending reconnection attempt and resets the backoff counter. */
function cancelReconnect(): void {
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    reconnectAttempts = 0;
}

/**
 * Establishes a WebSocket connection to the MCP server.
 */
function connectToMcpServer(baseUrl?: string, token?: string): void {
    // remember connection parameters so that automatic reconnection can reuse them
    shouldReconnect = true;
    lastConnectionUrl = baseUrl;
    lastConnectionToken = token;

    if (ws?.readyState === WebSocket.OPEN) {
        updateConnectionStatus("connected", "Connected");
        return;
    }
    if (ws?.readyState === WebSocket.CONNECTING) {
        // a connection attempt is already in progress
        return;
    }

    try {
        let wsUrl = baseUrl || PENPOT_MCP_WEBSOCKET_URL;
        let wsError: unknown | undefined;

        if (token) {
            wsUrl += `?userToken=${encodeURIComponent(token)}`;
        }

        ws = new WebSocket(wsUrl);
        updateConnectionStatus("connecting", "Connecting...");

        ws.onopen = () => {
            // a successful connection clears any pending backoff and (re)starts the heartbeat
            cancelReconnect();
            startHeartbeat();
            setTimeout(() => {
                if (ws) {
                    console.log("Connected to MCP server");
                    updateConnectionStatus("connected", "Connected");
                }
            }, 100);
        };

        ws.onmessage = (event) => {
            try {
                console.log("Received from MCP server:", event.data);
                const request = JSON.parse(event.data);
                // Track the current task received from the MCP server
                if (request.task) {
                    updateCurrentTask(request.task);
                    updateExecutedCode(request.params?.code ?? null);
                }
                // Forward the task request to the plugin for execution
                parent.postMessage(request, "*");
            } catch (error) {
                console.error("Failed to parse WebSocket message:", error);
            }
        };

        ws.onclose = (event: CloseEvent) => {
            stopHeartbeat();
            // If we've send the error update we don't send the disconnect as well
            if (!wsError) {
                console.log("Disconnected from MCP server");
                const label = event.reason ? `Disconnected: ${event.reason}` : "Disconnected";
                updateConnectionStatus("disconnected", label);
                updateCurrentTask(null);
            }
            ws = null;
            // unless this was an intentional disconnect, attempt to re-establish the connection
            // (e.g. after a transient network drop or after the browser discarded the tab)
            scheduleReconnect();
        };

        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            wsError = error;
            // note: WebSocket error events typically don't contain detailed error messages
            updateConnectionStatus("error", "Connection error");
        };
    } catch (error) {
        console.error("Failed to connect to MCP server:", error);
        const reason = error instanceof Error ? error.message : undefined;
        const label = reason ? `Connection failed: ${reason}` : "Connection failed";
        updateConnectionStatus("error", label);
    }
}

/**
 * Intentionally disconnects from the MCP server and disables automatic reconnection.
 * Used for user-initiated disconnects and the "stop-server" command.
 */
function disconnectFromMcpServer(): void {
    shouldReconnect = false;
    cancelReconnect();
    stopHeartbeat();
    ws?.close();
}

copyCodeBtn?.addEventListener("click", () => {
    const code = executedCodeEl?.value;
    if (!code) return;

    navigator.clipboard.writeText(code).then(() => {
        copyCodeBtn.classList.add("copied");
        setTimeout(() => copyCodeBtn.classList.remove("copied"), 1500);
    });
});

connectBtn?.addEventListener("click", () => {
    connectToMcpServer();
});

disconnectBtn?.addEventListener("click", () => {
    disconnectFromMcpServer();
});

// Listen plugin.ts messages
window.addEventListener("message", (event) => {
    if (event.data.type === "mcp-mode") {
        isIntegratedRemoteMcp = event.data.integratedRemoteMcp;
    }
    if (event.data.type === "start-server") {
        connectToMcpServer(event.data.url, event.data.token);
    }
    if (event.data.type === "version-mismatch") {
        if (versionWarningEl && versionWarningTextEl) {
            versionWarningTextEl.innerHTML =
                `<b>Version mismatch detected</b>: This version of the MCP server is intended for Penpot ` +
                `${event.data.mcpVersion} while the current version is ${event.data.penpotVersion}. ` +
                `Executions may not work or produce suboptimal results.`;
            versionWarningEl.hidden = false;
        }
    }
    if (event.data.type === "stop-server") {
        disconnectFromMcpServer();
    } else if (event.data.source === "penpot") {
        document.body.dataset.theme = event.data.theme;
    } else if (event.data.type === "task-response") {
        // Forward task response back to MCP server
        sendTaskResponse(event.data.response);
    }
});

/**
 * Reacts to the tab waking up after the browser throttled, froze, or discarded it.
 *
 * Browsers suspend background tabs to save resources, which silently stalls the MCP
 * connection: while frozen, the page's event loop (and thus task handling) is paused even
 * though the socket may still appear open at the protocol level. When the tab becomes
 * active again we want to recover immediately rather than wait for the next backoff tick:
 *
 *  - if the socket survived (e.g. a mere freeze), send an immediate heartbeat so the server
 *    sees the connection as live again without delay;
 *  - if the socket was lost (e.g. the tab was discarded, or the network dropped), reconnect
 *    now, resetting the backoff so recovery is not delayed.
 */
function handleTabResumed(): void {
    if (!shouldReconnect) {
        return;
    }
    if (ws?.readyState === WebSocket.OPEN) {
        sendHeartbeat();
    } else if (ws?.readyState !== WebSocket.CONNECTING) {
        cancelReconnect();
        connectToMcpServer(lastConnectionUrl, lastConnectionToken);
    }
}

// the "freeze" event fires when the browser is about to freeze the page (Page Lifecycle API).
// This is the last point at which we can run code, so we notify the server synchronously that
// the tab is going to sleep. The send is handed to the browser's network process (separate from
// the renderer being frozen), so the notice is flushed even as this page's event loop pauses.
// This lets the server fail fast with a clear "tab frozen" message instead of waiting for the
// heartbeat to go stale.
document.addEventListener("freeze", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "freeze" }));
    }
});

// the "resume" event fires when a frozen page is unfrozen (Page Lifecycle API)
document.addEventListener("resume", handleTabResumed);

// visibility changes cover the common "tab brought back to the foreground" case
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        handleTabResumed();
    }
});

parent.postMessage({ type: "ui-initialized" }, "*");
