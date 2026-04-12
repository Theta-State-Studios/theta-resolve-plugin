const api = new ReviewPortalAPI();

let currentScreen = "login";
let currentClient = null;
let currentStatusFilter = "all";
let renderPollTimer = null;
let currentRenderState = null;
let currentUser = null;

// ── Initialization ──

async function init() {
    const health = await window.theta.health();
    if (!health.resolve_connected) {
        showError("DaVinci Resolve scripting API is unavailable.");
    }

    // Check if already logged in
    const auth = await window.theta.getAuthStatus();
    if (auth.logged_in) {
        currentUser = { name: auth.user, displayName: auth.display_name };
        showScreen("clients");
        loadClients();
    } else {
        showScreen("login");
    }
}

// ── Screen Management ──

function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const screen = document.getElementById(`screen-${name}`);
    if (screen) {
        screen.classList.add("active");
        currentScreen = name;
    }
}

// ── Login Screen ──

async function handleLogin(e) {
    if (e) e.preventDefault();

    const name = document.getElementById("login-name").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("login-btn");

    if (!name || !password) {
        errorEl.textContent = "Name and password are required";
        errorEl.classList.remove("hidden");
        return;
    }

    errorEl.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    const result = await window.theta.login(name, password);

    btn.disabled = false;
    btn.textContent = "Sign In";

    if (result.error) {
        errorEl.textContent = result.error;
        errorEl.classList.remove("hidden");
        return;
    }

    currentUser = {
        name: result.user || name,
        displayName: result.displayName || result.user || name,
    };

    document.getElementById("login-password").value = "";
    showScreen("clients");
    loadClients();
}

// ── Screen 1: Client List ──

async function loadClients() {
    const content = document.getElementById("client-list");
    content.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>';

    const { clients, error } = await api.getReviewsGroupedByClient();

    if (error) {
        content.innerHTML = `
            <div class="error-banner">
                ${escapeHtml(error)}
                <button class="btn btn-small" onclick="loadClients()">Retry</button>
            </div>`;
        return;
    }

    if (clients.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-text">No active reviews found</div>
            </div>`;
        return;
    }

    window._clients = clients;
    renderClientList(clients);
}

function renderClientList(clients) {
    const content = document.getElementById("client-list");
    content.innerHTML = clients
        .map(
            (client) => `
        <div class="client-item" onclick="openClient('${escapeAttr(client.name)}')">
            <div class="client-name">${escapeHtml(client.name)}</div>
            <div class="client-meta">
                ${client.reviewCount} review${client.reviewCount !== 1 ? "s" : ""}
                ${api.getStatusCounts(client.reviews) ? ` \u00b7 ${api.getStatusCounts(client.reviews)}` : ""}
            </div>
        </div>`
        )
        .join("");
}

function filterClients() {
    const query = document.getElementById("search-input").value.toLowerCase();
    if (!window._clients) return;
    const filtered = window._clients.filter((c) => c.name.toLowerCase().includes(query));
    renderClientList(filtered);
}

// ── Screen 2: Client Reviews ──

async function openClient(clientName, { refresh = false } = {}) {
    currentStatusFilter = "all";
    document.getElementById("client-title").textContent = clientName;
    document.getElementById("review-list").innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>';
    document.getElementById("status-filter").innerHTML = "";
    showScreen("reviews");

    // Only re-fetch when the caller explicitly requests it (after state-changing operations).
    // Normal navigation reuses window._clients already loaded by loadClients().
    if (refresh || !window._clients) {
        const { clients, error } = await api.getReviewsGroupedByClient();
        if (error) {
            document.getElementById("review-list").innerHTML = `
                <div class="error-banner">${escapeHtml(error)}</div>`;
            return;
        }
        if (clients.length > 0) window._clients = clients;
    }

    const client = window._clients?.find((c) => c.name === clientName);
    if (!client) {
        document.getElementById("review-list").innerHTML = '<div class="empty-state"><div class="empty-state-text">No reviews found</div></div>';
        return;
    }

    currentClient = client;
    renderStatusFilter(client.reviews);
    renderReviewList(client.reviews);
}

function renderStatusFilter(reviews) {
    const container = document.getElementById("status-filter");
    const counts = { all: reviews.length };
    for (const r of reviews) {
        counts[r.status] = (counts[r.status] || 0) + 1;
    }

    const filters = [
        { key: "all", label: "All" },
        { key: "waiting", label: "Waiting" },
        { key: "editing", label: "Editing" },
        { key: "in-review", label: "In Review" },
        { key: "needs-edits", label: "Needs Edits" },
        { key: "approved", label: "Approved" },
    ];

    container.innerHTML = filters
        .filter((f) => counts[f.key])
        .map(
            (f) =>
                `<button class="filter-chip ${currentStatusFilter === f.key ? "active" : ""}" onclick="setStatusFilter('${f.key}')">
                    ${f.label} <span class="filter-count">${counts[f.key]}</span>
                </button>`
        )
        .join("");
}

function setStatusFilter(status) {
    currentStatusFilter = status;
    if (!currentClient) return;
    renderStatusFilter(currentClient.reviews);
    const filtered =
        status === "all" ? currentClient.reviews : currentClient.reviews.filter((r) => r.status === status);
    renderReviewList(filtered);
}

function renderReviewList(reviews) {
    const content = document.getElementById("review-list");
    content.innerHTML = reviews
        .map((review) => {
            const deliverables = review.deliverables || [];
            const deliverableCards = deliverables
                .map(
                    (d) => `
                <div class="deliverable-card">
                    <div class="deliverable-card-header">
                        <span class="deliverable-card-label" onclick="promptRenameDeliverable('${escapeAttr(d.id || "")}', '${escapeAttr(d.label || "")}')" title="Click to rename">${escapeHtml(d.label || "Untitled")}</span>
                        <div class="deliverable-card-actions-inline">
                            <button class="btn-icon btn-edit" onclick="promptRenameDeliverable('${escapeAttr(d.id || "")}', '${escapeAttr(d.label || "")}')" title="Rename deliverable">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.5-6.5zm-9.761 5.175l-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 015 12.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.468-.325z"/>
                                </svg>
                            </button>
                            <button class="btn-icon btn-delete" onclick="deleteDeliverable('${escapeAttr(d.id || "")}', '${escapeAttr(d.label || "Untitled")}', '${escapeAttr(review.key)}', this)" title="Remove deliverable">
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                    <path d="M3.17 3.17a.5.5 0 01.7 0L6 5.3l2.13-2.13a.5.5 0 01.7.7L6.71 6l2.12 2.13a.5.5 0 01-.7.7L6 6.71 3.87 8.83a.5.5 0 01-.7-.7L5.3 6 3.17 3.87a.5.5 0 010-.7z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="deliverable-card-meta">
                        v${d.version || 0}
                        <span class="deliverable-status-dot status-dot ${d.status || "in-review"}" title="${escapeAttr(d.statusLabel || "")}"></span>
                        <span class="deliverable-status-label ${d.status || "in-review"}">${escapeHtml(d.statusLabel || "In Review")}</span>
                    </div>
                    <div class="deliverable-card-actions">
                        <button class="btn btn-primary btn-small" onclick="startUpload('${escapeAttr(review.key)}', ${(d.version || 0) + 1}, '${escapeAttr(d.label || "")}', '${escapeAttr(review.reviewToken || "")}')">
                            ${d.version > 0 ? "Upload New Version" : "Upload Current Timeline"}
                        </button>
                        ${d.commentCount > 0 ? `<button class="btn btn-small btn-comments" onclick="openComments('${escapeAttr(review.key)}', '${escapeAttr(d.id || "")}', '${escapeAttr(d.label || "")}', ${d.version || 0}, '${escapeAttr(review.reviewToken || "")}')">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 3A1.5 1.5 0 001 4.5v7A1.5 1.5 0 002.5 13h2.5l3 3 3-3h2.5a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0013.5 3h-11zM4 6.5h8a.5.5 0 010 1H4a.5.5 0 010-1zm0 2.5h5a.5.5 0 010 1H4a.5.5 0 010-1z"/></svg>
                            ${d.commentCount}
                        </button>` : ""}</div>
                </div>`
                )
                .join("");

            let claimHtml = "";
            if (review.status === "waiting") {
                claimHtml = `
                    <button class="btn btn-primary btn-small" onclick="claimTask('${escapeAttr(review.key)}', this)" style="margin-bottom:8px">
                        Start Editing
                    </button>`;
            }

            return `
            <div class="review-item">
                <div class="review-header">
                    <span class="review-key">${escapeHtml(review.key)}</span>
                </div>
                <div class="review-name" onclick="openReviewLink('${escapeAttr(review.reviewUrl || "")}')">${escapeHtml(review.shortName)}</div>
                <div class="review-status">
                    <span class="status-dot ${review.status}"></span>
                    ${escapeHtml(review.statusLabel)}
                </div>
                ${claimHtml}
                <div class="deliverable-cards">${deliverableCards}</div>
                <button class="btn-link add-deliverable-btn" onclick="promptAddDeliverable('${escapeAttr(review.key)}')">+ Add Deliverable</button>
            </div>`;
        })
        .join("");
}

async function claimTask(jiraKey, btnEl) {
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = "Claiming...";
    }

    const result = await window.theta.claimTask(jiraKey);

    if (result.error) {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = "Start Editing";
        }
        showError(result.error);
        return;
    }

    if (currentClient) {
        const review = currentClient.reviews.find((r) => r.key === jiraKey);
        if (review) {
            review.status = "editing";
            review.statusLabel = "Editing";
        }
        renderStatusFilter(currentClient.reviews);
        const filtered =
            currentStatusFilter === "all"
                ? currentClient.reviews
                : currentClient.reviews.filter((r) => r.status === currentStatusFilter);
        renderReviewList(filtered);
    }
}

function goBackToClients() {
    currentClient = null;
    currentStatusFilter = "all";
    showScreen("clients");
    loadClients();
}

function openReviewLink(url) {
    if (url) window.open(url, "_blank");
}

// ── Add Deliverable Modal ──

function promptAddDeliverable(jiraKey) {
    document.getElementById("modal-mode").value = "add";
    document.getElementById("modal-jira-key").value = jiraKey;
    document.getElementById("modal-deliverable-id").value = "";
    document.getElementById("modal-label-input").value = "";
    document.getElementById("modal-label-input").placeholder = "e.g. Office Tour Reel";
    document.getElementById("modal-title").textContent = "Add Deliverable";
    document.getElementById("modal-confirm-btn").textContent = "Add";
    document.getElementById("modal-overlay").classList.remove("hidden");
    setTimeout(() => document.getElementById("modal-label-input").focus(), 50);
}

function promptRenameDeliverable(deliverableId, currentLabel) {
    if (!deliverableId) return;
    document.getElementById("modal-mode").value = "rename";
    document.getElementById("modal-jira-key").value = "";
    document.getElementById("modal-deliverable-id").value = deliverableId;
    document.getElementById("modal-label-input").value = currentLabel || "";
    document.getElementById("modal-label-input").placeholder = "New deliverable name";
    document.getElementById("modal-title").textContent = "Rename Deliverable";
    document.getElementById("modal-confirm-btn").textContent = "Save";
    document.getElementById("modal-overlay").classList.remove("hidden");
    setTimeout(() => {
        const input = document.getElementById("modal-label-input");
        input.focus();
        input.select();
    }, 50);
}

async function confirmModal() {
    const mode = document.getElementById("modal-mode").value;
    if (mode === "rename") {
        await confirmRenameDeliverable();
    } else {
        await confirmAddDeliverable();
    }
}

function closeModal() {
    document.getElementById("modal-overlay").classList.add("hidden");
}

async function confirmAddDeliverable() {
    const jiraKey = document.getElementById("modal-jira-key").value;
    const label = document.getElementById("modal-label-input").value.trim();
    if (!label) return;

    const btn = document.querySelector("#modal-overlay .btn-primary");
    btn.disabled = true;
    btn.textContent = "Adding...";

    const result = await window.theta.addDeliverable(jiraKey, label);

    btn.disabled = false;
    btn.textContent = "Add";

    if (result.error) {
        showError(result.error);
        return;
    }

    closeModal();

    // Refresh the review list to show the new card
    if (currentClient) {
        await openClient(currentClient.name, { refresh: true });
    }
}

async function confirmRenameDeliverable() {
    const deliverableId = document.getElementById("modal-deliverable-id").value;
    const newLabel = document.getElementById("modal-label-input").value.trim();
    if (!newLabel || !deliverableId) return;

    const btn = document.getElementById("modal-confirm-btn");
    btn.disabled = true;
    btn.textContent = "Saving...";

    const result = await window.theta.renameDeliverable(deliverableId, newLabel);

    btn.disabled = false;
    btn.textContent = "Save";

    if (result.error) {
        showError(result.error);
        return;
    }

    closeModal();

    // Refresh the review list to show the renamed card
    if (currentClient) {
        await openClient(currentClient.name, { refresh: true });
    }
}

async function deleteDeliverable(deliverableId, label, jiraKey, btnEl) {
    if (!confirm(`Remove "${label}" from ${jiraKey}?`)) return;

    if (btnEl) btnEl.disabled = true;

    const result = await window.theta.deleteDeliverable(deliverableId);

    if (result.error) {
        if (btnEl) btnEl.disabled = false;
        showError(result.error);
        return;
    }

    // Refresh the review list
    if (currentClient) {
        await openClient(currentClient.name, { refresh: true });
    }
}

// ── Comments Screen ──

let currentCommentContext = null;
let activeCommentId = null;

async function openComments(jiraKey, deliverableId, label, version, reviewToken) {
    currentCommentContext = { jiraKey, deliverableId, label, version, reviewToken };
    activeCommentId = null;

    document.getElementById("comments-title").textContent = label || "Comments";
    document.getElementById("comments-version").textContent = `v${version}`;
    document.getElementById("comments-list").innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>';

    showScreen("comments");

    const data = await window.theta.getComments(reviewToken, deliverableId);

    if (data.error) {
        document.getElementById("comments-list").innerHTML = `
            <div class="error-banner">
                ${escapeHtml(data.error)}
                <button class="btn btn-small" onclick="openComments('${escapeAttr(jiraKey)}', '${escapeAttr(deliverableId)}', '${escapeAttr(label)}', ${version}, '${escapeAttr(reviewToken)}')">Retry</button>
            </div>`;
        return;
    }

    const comments = data.comments || [];

    if (comments.length === 0) {
        document.getElementById("comments-list").innerHTML = `
            <div class="empty-state">
                <div class="empty-state-text">No comments yet</div>
            </div>`;
        return;
    }

    renderComments(comments);
}

function renderComments(comments) {
    const container = document.getElementById("comments-list");
    container.innerHTML = comments
        .map((c) => {
            const isAddressed = c.addressed;
            return `
            <div class="comment-item ${isAddressed ? "addressed" : ""} ${activeCommentId === c.id ? "active" : ""}" data-comment-id="${escapeAttr(c.id)}">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(c.author || "Reviewer")}</span>
                    ${c.timecodeFormatted ? `<button class="comment-timecode" onclick="seekToComment('${escapeAttr(c.id)}', '${escapeAttr(c.timecodeFormatted)}')">${escapeHtml(c.timecodeFormatted)}</button>` : ""}
                </div>
                <div class="comment-text">${escapeHtml(c.text)}</div>
                <button class="comment-check ${isAddressed ? "checked" : ""}" onclick="toggleAddressed('${escapeAttr(c.id)}', ${!isAddressed}, this)" title="${isAddressed ? "Mark as unaddressed" : "Mark as addressed"}">
                    ${isAddressed
                        ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.354 4.646a.5.5 0 00-.708 0L7 9.293 5.354 7.646a.5.5 0 10-.708.708l2 2a.5.5 0 00.708 0l4-4a.5.5 0 000-.708z"/></svg>'
                        : '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 1a6 6 0 100 12A6 6 0 008 2z"/></svg>'
                    }
                </button>
            </div>`;
        })
        .join("");
}

async function seekToComment(commentId, timecode) {
    activeCommentId = commentId;

    // Highlight the active comment
    document.querySelectorAll(".comment-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.commentId === commentId);
    });

    const result = await window.theta.seekToTimecode(timecode);
    if (result.error) {
        showError(result.error);
    }
}

async function toggleAddressed(commentId, addressed, btnEl) {
    if (!currentCommentContext) return;

    const result = await window.theta.setCommentAddressed(
        currentCommentContext.reviewToken,
        commentId,
        addressed
    );

    if (result.error) {
        showError(result.error);
        return;
    }

    // Update the card inline
    const card = btnEl.closest(".comment-item");
    if (card) {
        card.classList.toggle("addressed", addressed);
        btnEl.className = `comment-check ${addressed ? "checked" : ""}`;
        btnEl.title = addressed ? "Mark as unaddressed" : "Mark as addressed";
        btnEl.innerHTML = addressed
            ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.354 4.646a.5.5 0 00-.708 0L7 9.293 5.354 7.646a.5.5 0 10-.708.708l2 2a.5.5 0 00.708 0l4-4a.5.5 0 000-.708z"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 1a6 6 0 100 12A6 6 0 008 2z"/></svg>';
        // Update the onclick to flip the addressed state
        btnEl.setAttribute("onclick", `toggleAddressed('${escapeAttr(commentId)}', ${!addressed}, this)`);
    }
}

function goBackFromComments() {
    currentCommentContext = null;
    activeCommentId = null;
    if (currentClient) {
        openClient(currentClient.name);
    } else {
        showScreen("clients");
    }
}

// ── Screen 3: Render & Upload ──

async function startUpload(jiraKey, version, label, reviewToken) {
    currentRenderState = { jiraKey, version, label, reviewToken, outputPath: null };

    document.getElementById("progress-title").textContent = `Uploading to ${jiraKey}`;
    document.getElementById("render-status-row").classList.remove("complete");
    document.getElementById("render-settings-info").textContent = "Rendering in Resolve...";
    document.getElementById("upload-step-status").textContent = "(waiting for render)";
    document.getElementById("portal-step-status").textContent = "(waiting)";
    document.getElementById("step-render").classList.remove("text-success");
    document.getElementById("step-upload").classList.remove("text-success");
    document.getElementById("step-portal").classList.remove("text-success");

    showScreen("progress");

    const result = await window.theta.startRender(jiraKey, version, null, label);

    if (result.error) {
        showProgressError(result.error);
        return;
    }

    currentRenderState.outputPath = result.output_path;

    const settings = result.settings || {};
    document.getElementById("render-settings-info").textContent =
        `${settings.resolution || "1920x1080"} H.264 \u00b7 ${Math.round((settings.bitrate || 10000000) / 1000000)} Mbps`;

    pollRenderProgress();
}

let renderFinished = false;

const MAX_POLL_MS = 90 * 60 * 1000; // 90 minutes — cancel and prompt after this
const POLL_INTERVAL_MS = 1500;

function pollRenderProgress() {
    if (renderPollTimer) clearInterval(renderPollTimer);
    renderFinished = false;

    const pollStartTime = Date.now();

    // Listen for the RenderStop callback from main process as a backup signal
    const onRenderStopped = () => {
        console.log("[Theta] RenderStop callback received in renderer");
        renderFinished = true;
    };
    window.addEventListener("theta:renderStopped", onRenderStopped, { once: true });

    function stopPolling() {
        clearInterval(renderPollTimer);
        renderPollTimer = null;
        window.removeEventListener("theta:renderStopped", onRenderStopped);
    }

    renderPollTimer = setInterval(async () => {
        // Max duration check — prompt the user if the render is taking too long
        const elapsed = Date.now() - pollStartTime;
        if (elapsed > MAX_POLL_MS) {
            stopPolling();
            const minutes = Math.round(MAX_POLL_MS / 60000);
            showRenderTimeoutPrompt(minutes);
            return;
        }

        const progress = await window.theta.getRenderProgress();
        console.log("[Theta] Poll result:", JSON.stringify(progress), "renderFinished:", renderFinished);

        if (progress.error) {
            stopPolling();
            showProgressError(progress.error);
            return;
        }

        // Detect completion via either: status says Complete, progress >= 100, or RenderStop callback fired
        const pct = progress.progress;
        const isComplete = progress.status === "Complete" || pct >= 100 || renderFinished;
        const isFailed = progress.status === "Failed" || progress.status === "Cancelled"
            || (progress.status && progress.status.toLowerCase().includes("fail"));

        if (isFailed) {
            stopPolling();
            showProgressError(`Render ${progress.status.toLowerCase()}`);
        } else if (isComplete) {
            stopPolling();
            document.getElementById("render-status-row").classList.add("complete");
            document.getElementById("render-settings-info").textContent = "Render complete";
            document.getElementById("step-render").classList.add("text-success");
            onRenderComplete();
        }
    }, POLL_INTERVAL_MS);
}

function showRenderTimeoutPrompt(minutes) {
    // Replace the render status info with a timeout warning and continue/cancel buttons
    const statusEl = document.getElementById("render-settings-info");
    if (statusEl) {
        statusEl.innerHTML = `
            <span style="color: var(--color-warning, #f59e0b);">
                Render is taking longer than ${minutes} minutes.
            </span>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button onclick="resumeRenderPoll()" style="font-size:12px;padding:4px 10px;border-radius:6px;background:var(--color-accent,#f97316);color:#fff;border:none;cursor:pointer;">
                    Keep waiting
                </button>
                <button onclick="cancelUpload()" style="font-size:12px;padding:4px 10px;border-radius:6px;background:transparent;border:1px solid currentColor;cursor:pointer;">
                    Cancel render
                </button>
            </div>
        `;
    }
}

function resumeRenderPoll() {
    // Restore the status display and restart polling
    const statusEl = document.getElementById("render-settings-info");
    if (statusEl) {
        statusEl.innerHTML = "Waiting for render to complete…";
    }
    pollRenderProgress();
}

async function onRenderComplete() {
    document.getElementById("upload-step-status").textContent = "Starting upload...";

    // Listen for live progress updates from main process
    const onUploadProgress = (e) => {
        const msg = e.detail || "";
        document.getElementById("upload-step-status").textContent = msg;
        // When the message indicates we've moved to the portal step, mark
        // upload step as done so it visually progresses.
        if (msg.toLowerCase().includes("updating jira") || msg.toLowerCase().includes("portal")) {
            document.getElementById("step-upload").classList.add("text-success");
            document.getElementById("portal-step-status").textContent = msg;
        }
    };
    window.addEventListener("theta:uploadProgress", onUploadProgress);

    const result = await window.theta.upload(
        currentRenderState.outputPath,
        currentRenderState.jiraKey,
        currentRenderState.label,
        currentRenderState.reviewToken
    );

    window.removeEventListener("theta:uploadProgress", onUploadProgress);

    if (result.error) {
        showProgressError(result.error);
        return;
    }

    document.getElementById("step-upload").classList.add("text-success");
    document.getElementById("upload-step-status").textContent = "Complete";
    document.getElementById("portal-step-status").textContent = "Complete";
    document.getElementById("step-portal").classList.add("text-success");

    showUploadComplete(result);
}

function showUploadComplete(result) {
    const review = currentClient?.reviews?.find((r) => r.key === currentRenderState?.jiraKey);

    document.getElementById("complete-review-info").textContent =
        `${currentRenderState.jiraKey} \u00b7 ${review?.shortName || ""}`;
    document.getElementById("complete-version").textContent = `v${currentRenderState.version}`;
    document.getElementById("complete-status").textContent = "In Review";

    const reviewUrl = result.reviewUrl || result.url || "";
    document.getElementById("complete-review-link").textContent = reviewUrl;
    document.getElementById("complete-review-link").dataset.url = reviewUrl;

    showScreen("complete");
}

function cancelUpload() {
    if (renderPollTimer) {
        clearInterval(renderPollTimer);
        renderPollTimer = null;
    }
    window.theta.cancelRender();
    currentRenderState = null;

    if (currentClient) {
        showScreen("reviews");
    } else {
        showScreen("clients");
    }
}

function showProgressError(message) {
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.innerHTML = `${escapeHtml(message)} <button class="btn btn-small" onclick="retryUpload()">Retry</button>`;
    document.getElementById("progress-errors").innerHTML = "";
    document.getElementById("progress-errors").appendChild(banner);
}

function retryUpload() {
    if (currentRenderState) {
        startUpload(currentRenderState.jiraKey, currentRenderState.version, currentRenderState.label);
    }
}

// ── Screen 3b: Complete ──

function openCompletedReview() {
    const url = document.getElementById("complete-review-link").dataset.url;
    if (url) window.open(url, "_blank");
}

function copyReviewLink() {
    const url = document.getElementById("complete-review-link").dataset.url;
    if (url) {
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById("copy-link-btn");
            btn.textContent = "Copied!";
            setTimeout(() => (btn.textContent = "Copy Link"), 2000);
        });
    }
}

function backToReviewsFromComplete() {
    currentRenderState = null;
    if (currentClient) {
        openClient(currentClient.name, { refresh: true });
    } else {
        showScreen("clients");
        loadClients();
    }
}

// ── Screen 4: Settings ──

async function openSettings() {
    const config = await window.theta.getConfig();
    const auth = await window.theta.getAuthStatus();

    if (auth.logged_in) {
        document.getElementById("settings-user-name").textContent = auth.display_name || auth.user;
        document.getElementById("settings-user-section").classList.remove("hidden");
    } else {
        document.getElementById("settings-user-section").classList.add("hidden");
    }

    document.getElementById("settings-output-dir").value = config.output_dir || "/tmp/theta-review-exports";

    const presetName = config.render_preset || "review";
    selectPreset(typeof presetName === "string" ? presetName : "review");

    const toggle = document.getElementById("settings-keep-local");
    if (config.keep_local_copy) {
        toggle.classList.add("on");
    } else {
        toggle.classList.remove("on");
    }

    showScreen("settings");
}

function selectPreset(name) {
    document.querySelectorAll(".radio-option").forEach((el) => {
        el.classList.toggle("selected", el.dataset.preset === name);
    });
}

function toggleKeepLocal() {
    document.getElementById("settings-keep-local").classList.toggle("on");
}

async function saveSettings() {
    const config = {
        output_dir: document.getElementById("settings-output-dir").value.trim(),
        keep_local_copy: document.getElementById("settings-keep-local").classList.contains("on"),
    };

    const selectedPreset = document.querySelector(".radio-option.selected");
    if (selectedPreset) config.render_preset = selectedPreset.dataset.preset;

    await window.theta.saveConfig(config);
    showScreen("clients");
    loadClients();
}

async function handleLogout() {
    await window.theta.logout();
    currentUser = null;
    showScreen("login");
}

function goBackFromSettings() {
    showScreen("clients");
}

// ── Error Display ──

function showError(message) {
    const existing = document.querySelector(".error-banner.global-error");
    if (existing) existing.remove();
    const banner = document.createElement("div");
    banner.className = "error-banner global-error";
    banner.innerHTML = escapeHtml(message);
    document.body.prepend(banner);
}

// ── Utilities ──

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
}

// ── Boot ──

window.addEventListener("DOMContentLoaded", init);

window.addEventListener("beforeunload", async () => {
    await window.theta.cleanup();
});
