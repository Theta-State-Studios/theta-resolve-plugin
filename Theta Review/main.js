const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

// Load the platform-specific Resolve scripting bridge.
// When installed as a Resolve plugin, WorkflowIntegration.node sits at the plugin root.
// In dev, fall back to native/<platform>/ so we don't need to keep the root copy in git.
const rootNodePath = path.join(__dirname, 'WorkflowIntegration.node');
const devNodePath  = path.join(__dirname, 'native', process.platform === 'win32' ? 'win' : 'mac', 'WorkflowIntegration.node');
const WorkflowIntegration = require(fs.existsSync(rootNodePath) ? rootNodePath : devNodePath);

const PLUGIN_ID = 'com.theta-studios.review';

// Config lives in ~/.theta-review/ so it survives plugin updates (which overwrite the plugin folder).
const CONFIG_DIR    = path.join(os.homedir(), '.theta-review');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'config.json');
const CREDS_PATH    = path.join(CONFIG_DIR, 'credentials.json');

// Credential keys — always stored in credentials.json, never in config.json
const CREDENTIAL_KEYS = new Set(['auth_token', 'watcher_secret', 'jira_user', 'display_name']);

// Platform-appropriate default export directory.
// Uses the user's Documents folder so the files are visible and don't get
// wiped by the OS on reboot (unlike os.tmpdir).
// - macOS:   /Users/<user>/Documents/Theta Review Exports
// - Windows: C:\Users\<user>\Documents\Theta Review Exports
function getDefaultOutputDir() {
    try {
        return path.join(app.getPath('documents'), 'Theta Review Exports');
    } catch {
        // Fallback during early init before app.ready
        return path.join(os.homedir(), 'Documents', 'Theta Review Exports');
    }
}

// Stale paths from older config versions that should be migrated to the new default.
const LEGACY_OUTPUT_PATHS = [
    '/tmp/theta-review-exports',
    'C:\\tmp\\theta-review-exports',
    'C:/tmp/theta-review-exports',
];

let mainWindow = null;
let resolveObj = null;
let projectManagerObj = null;
let currentRenderJobId = null;
let renderCompleteResolver = null;

// ── Config ──

function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadConfig() {
    ensureConfigDir();
    let settings = {};
    let creds = {};

    // Load settings file
    try {
        settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch {
        settings = getDefaultSettings();
    }

    // Load credentials file
    try {
        creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
    } catch {
        creds = {};
    }

    // One-time migration: if credentials.json is empty but config.json has them,
    // extract and move them to credentials.json
    if (!creds.auth_token && (settings.auth_token || settings.watcher_secret)) {
        for (const key of CREDENTIAL_KEYS) {
            if (settings[key]) creds[key] = settings[key];
        }
        try { saveCredentials(creds); } catch {}
        // Strip credentials from settings file
        for (const key of CREDENTIAL_KEYS) delete settings[key];
        try { saveSettings(settings); } catch {}
    }

    const config = { ...getDefaultConfig(), ...settings, ...creds };

    // Migrate stale legacy output_dir paths to the platform default.
    if (!config.output_dir || LEGACY_OUTPUT_PATHS.includes(config.output_dir)) {
        const newDir = getDefaultOutputDir();
        if (config.output_dir !== newDir) {
            config.output_dir = newDir;
            try { saveConfig(config); } catch {}
        }
    }

    return config;
}

function saveSettings(settings) {
    // Strip any credentials that may have slipped in
    const safe = { ...settings };
    for (const key of CREDENTIAL_KEYS) delete safe[key];
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(safe, null, 2));
}

function saveCredentials(creds) {
    const credOnly = {};
    for (const key of CREDENTIAL_KEYS) {
        if (key in creds) credOnly[key] = creds[key];
    }
    fs.writeFileSync(CREDS_PATH, JSON.stringify(credOnly, null, 2));
}

function saveConfig(config) {
    const settings = {};
    const creds = {};
    for (const [key, value] of Object.entries(config)) {
        if (CREDENTIAL_KEYS.has(key)) {
            creds[key] = value;
        } else {
            settings[key] = value;
        }
    }
    saveSettings(settings);
    saveCredentials(creds);
}

function getDefaultSettings() {
    return {
        portal_url: 'https://review.theta-studios.com',
        render_preset: 'review',
        output_dir: getDefaultOutputDir(),
        keep_local_copy: false,
    };
}

function getDefaultConfig() {
    return {
        portal_url: 'https://review.theta-studios.com',
        auth_token: '',
        watcher_secret: '',
        jira_user: '',
        display_name: '',
        render_preset: 'review',
        output_dir: getDefaultOutputDir(),
        keep_local_copy: false,
    };
}

function resolveOutputDir(config) {
    // If a user-set path exists and isn't a known legacy path, honor it.
    // Otherwise fall back to the platform-appropriate default.
    const configured = config.output_dir;
    if (!configured || LEGACY_OUTPUT_PATHS.includes(configured)) {
        return getDefaultOutputDir();
    }
    return configured;
}

const PRESETS = {
    proxy:  { width: 1280, height: 720,  bitrate: 5000000,  audio_bitrate: 320000 },
    review: { width: 1920, height: 1080, bitrate: 5000000,  audio_bitrate: 320000 },
    high:   { width: 1920, height: 1080, bitrate: 20000000, audio_bitrate: 320000 },
};

// ── HTTP helpers ──

function portalRequest(method, urlPath, body, config, timeoutMs = 120000) {
    return new Promise((resolve) => {
        const portalUrl = config.portal_url || 'https://review.theta-studios.com';
        const parsed = new URL(urlPath, portalUrl);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

        debugLog(`portalRequest ${method} ${parsed.pathname}${parsed.search} (timeout=${timeoutMs}ms)`);

        let settled = false;
        const safeResolve = (value) => {
            if (settled) return;
            settled = true;
            if (hardTimer) clearTimeout(hardTimer);
            resolve(value);
        };

        // Hard manual timeout — doesn't rely on req.setTimeout, which has
        // quirks across Electron/Node versions. This will fire no matter what.
        const hardTimer = setTimeout(() => {
            debugLog(`portalRequest ${method} ${parsed.pathname} HARD TIMEOUT after ${timeoutMs}ms`);
            try { req.destroy(new Error('hard timeout')); } catch {}
            safeResolve({ error: `Request timed out after ${Math.round(timeoutMs / 1000)}s` });
        }, timeoutMs);

        let req;
        try {
            req = lib.request(options, (res) => {
                debugLog(`portalRequest ${method} ${parsed.pathname} got response, status=${res.statusCode}`);
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    debugLog(`portalRequest ${method} ${parsed.pathname} → ${res.statusCode} (${data.length} bytes)`);
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            safeResolve({ error: json.error || `HTTP ${res.statusCode}` });
                        } else {
                            safeResolve(json);
                        }
                    } catch {
                        safeResolve({ error: `Invalid response (${res.statusCode}): ${data.substring(0, 200)}` });
                    }
                });
                res.on('error', (e) => {
                    debugLog(`portalRequest ${method} ${parsed.pathname} response error: ${e.message}`);
                    safeResolve({ error: `Response error: ${e.message}` });
                });
            });

            req.on('error', (e) => {
                debugLog(`portalRequest ${method} ${parsed.pathname} request error: ${e.message}`);
                safeResolve({ error: `Cannot reach Review Portal: ${e.message}` });
            });

            req.on('socket', (socket) => {
                debugLog(`portalRequest ${method} ${parsed.pathname} socket assigned`);
                socket.on('connect', () => {
                    debugLog(`portalRequest ${method} ${parsed.pathname} socket connected`);
                });
                socket.on('secureConnect', () => {
                    debugLog(`portalRequest ${method} ${parsed.pathname} TLS handshake complete`);
                });
            });

            if (payload) req.write(payload);
            req.end();
            debugLog(`portalRequest ${method} ${parsed.pathname} request sent`);
        } catch (e) {
            debugLog(`portalRequest ${method} ${parsed.pathname} exception: ${e.message}`);
            safeResolve({ error: `Request setup failed: ${e.message}` });
        }
    });
}

function emitUploadProgress(message) {
    if (mainWindow) {
        try {
            mainWindow.webContents.send('upload:progress', message);
        } catch {}
    }
    debugLog(`upload progress: ${message}`);
}

// Try to locate the rendered file. Resolve sometimes writes the file with
// a slightly different name (suffix, extension, case) than what we asked.
// If the expected path doesn't exist, scan the directory for the closest
// match by stem prefix.
function locateRenderedFile(expectedPath) {
    if (fs.existsSync(expectedPath)) return expectedPath;

    const dir = path.dirname(expectedPath);
    const stem = path.basename(expectedPath, path.extname(expectedPath));
    debugLog(`Expected file missing, scanning ${dir} for "${stem}*"`);

    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch (e) {
        debugLog(`Cannot read output dir ${dir}: ${e.message}`);
        return null;
    }

    // Match: same stem prefix + common video extension + written recently
    const candidates = entries
        .filter((name) => name.startsWith(stem))
        .map((name) => {
            const full = path.join(dir, name);
            try {
                const stat = fs.statSync(full);
                return { path: full, mtime: stat.mtimeMs, size: stat.size };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .filter((f) => f.size > 0)
        .sort((a, b) => b.mtime - a.mtime);

    if (candidates.length > 0) {
        debugLog(`Found candidate: ${candidates[0].path} (${candidates[0].size} bytes)`);
        return candidates[0].path;
    }

    debugLog(`No matching files found in ${dir}. Directory contents: ${entries.join(', ')}`);
    return null;
}

async function uploadFile(filePath, jiraKey, config, label, reviewToken) {
    // Verify the rendered file actually exists — Resolve may have written
    // it to a slightly different path than we expected.
    const resolvedFilePath = locateRenderedFile(filePath);
    if (!resolvedFilePath) {
        return {
            error: `Rendered file not found at ${filePath}. Check the output directory in Settings and verify Resolve wrote the file.`,
        };
    }
    if (resolvedFilePath !== filePath) {
        debugLog(`Using fallback path: ${resolvedFilePath}`);
    }
    filePath = resolvedFilePath;
    const fileName = path.basename(filePath);

    // Step 1: Get client token from portal
    emitUploadProgress('Getting upload token...');
    const tokenResult = await portalRequest('POST', '/api/upload/get-upload-url', {
        filename: fileName,
        jiraKey,
        label: label || undefined,
        secret: config.watcher_secret || undefined,
    }, config, 30000);

    if (tokenResult.error) {
        return { error: `Failed to get upload token: ${tokenResult.error}` };
    }

    const clientToken = tokenResult.clientToken;
    const pathname = tokenResult.pathname || `reviews/${fileName}`;

    if (!clientToken) {
        return { error: 'Portal did not return a client token' };
    }

    debugLog(`Got client token, pathname: ${pathname}`);

    // Step 2: Upload file directly to Vercel Blob using the client token
    const blobResult = await uploadToVercelBlob(filePath, pathname, clientToken);

    if (blobResult.error) {
        return { error: `Blob upload failed: ${blobResult.error}` };
    }

    const blobUrl = blobResult.url;
    debugLog(`Blob upload complete: ${blobUrl}`);

    // Step 3: Tell portal the upload is complete with retry.
    // This step calls Jira (status transition, comment, field update) which can
    // take 30+ seconds and occasionally fails transiently. Retry up to 3 times
    // with backoff — the blob is already uploaded so retrying is safe.
    const notifyPayload = {
        jiraKey,
        blobUrl,
        filename: fileName,
        label: label || undefined,
        secret: config.watcher_secret || undefined,
        reviewToken: reviewToken || undefined,
    };

    let completeResult = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const attemptLabel = attempt > 1 ? ` (attempt ${attempt}/${MAX_RETRIES})` : '';
        emitUploadProgress(`Updating Jira and review portal...${attemptLabel}`);
        completeResult = await portalRequest('POST', '/api/upload/complete-review', notifyPayload, config, 180000);
        if (!completeResult.error) break;

        debugLog(`complete-review attempt ${attempt} failed: ${completeResult.error}`);
        if (attempt < MAX_RETRIES) {
            const backoffMs = 2000 * attempt;
            emitUploadProgress(`Portal notification failed — retrying in ${backoffMs / 1000}s...`);
            await new Promise((r) => setTimeout(r, backoffMs));
        }
    }

    // Cleanup local file regardless of portal notification result — the blob
    // is already uploaded and the file is no longer needed locally.
    if (!config.keep_local_copy) {
        try { fs.unlinkSync(filePath); } catch {}
    }

    // If the portal notification ultimately failed, surface a clear error that
    // distinguishes "blob uploaded but Jira failed" from "upload failed entirely".
    if (completeResult && completeResult.error) {
        return {
            error: `Video uploaded to storage but portal notification failed: ${completeResult.error}. The file is safe — contact support or retry by re-uploading.`,
        };
    }

    return completeResult;
}

const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB per part (min 5MB required by Vercel Blob)
const MAX_RETRIES = 3;

async function uploadToVercelBlob(filePath, pathname, clientToken) {
    const stats = fs.statSync(filePath);
    const totalSize = stats.size;
    const totalParts = Math.ceil(totalSize / CHUNK_SIZE);

    emitUploadProgress(`Preparing upload (${(totalSize / 1024 / 1024).toFixed(1)} MB, ${totalParts} parts)`);
    debugLog(`Multipart upload: ${totalSize} bytes, ${totalParts} parts of ${CHUNK_SIZE / 1024 / 1024}MB`);

    // Step 1: Create multipart upload
    emitUploadProgress('Creating multipart upload...');
    const createResult = await blobApiRequest('POST', pathname, clientToken, {
        'x-mpu-action': 'create',
        'content-type': 'video/mp4',
        'x-content-type': 'video/mp4',
        'x-allow-overwrite': '1',
    });

    if (createResult.error) {
        return { error: `Failed to create multipart upload: ${stringifyError(createResult.error)}` };
    }

    const { uploadId, key } = createResult;
    if (!uploadId || !key) {
        return { error: `Invalid multipart create response: ${JSON.stringify(createResult)}` };
    }

    debugLog(`Created multipart upload: uploadId=${uploadId}`);

    // Open file handle for chunked reads — avoids loading the whole file into memory
    const fileHandle = fs.openSync(filePath, 'r');

    try {
        // Step 2: Upload each part with retries
        const parts = [];
        for (let i = 0; i < totalParts; i++) {
            const partNumber = i + 1;
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, totalSize);
            const chunkSize = end - start;

            // Read just this chunk from disk
            const chunk = Buffer.alloc(chunkSize);
            fs.readSync(fileHandle, chunk, 0, chunkSize, start);

            emitUploadProgress(`Uploading part ${partNumber} of ${totalParts}...`);

            let uploaded = false;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                debugLog(`Uploading part ${partNumber}/${totalParts} (${chunk.length} bytes, attempt ${attempt})`);

                const partResult = await blobApiRequest('POST', pathname, clientToken, {
                    'x-mpu-action': 'upload',
                    'x-mpu-key': encodeURIComponent(key),
                    'x-mpu-upload-id': uploadId,
                    'x-mpu-part-number': String(partNumber),
                    'content-type': 'application/octet-stream',
                    'content-length': String(chunk.length),
                }, chunk);

                if (partResult.etag) {
                    parts.push({ etag: partResult.etag, partNumber });
                    uploaded = true;
                    debugLog(`Part ${partNumber} complete: etag=${partResult.etag}`);
                    break;
                }

                debugLog(`Part ${partNumber} attempt ${attempt} failed: ${stringifyError(partResult.error) || 'no etag'}`);
                if (attempt === MAX_RETRIES) {
                    return { error: `Failed to upload part ${partNumber} after ${MAX_RETRIES} attempts: ${stringifyError(partResult.error)}` };
                }

                // Backoff between retries
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }

            if (!uploaded) {
                return { error: `Part ${partNumber} failed without explicit error` };
            }
        }

        // Step 3: Complete multipart upload
        emitUploadProgress(`Finalizing upload (${parts.length} parts)...`);
        debugLog(`Completing multipart upload with ${parts.length} parts`);
        const completeResult = await blobApiRequest('POST', pathname, clientToken, {
            'x-mpu-action': 'complete',
            'x-mpu-key': encodeURIComponent(key),
            'x-mpu-upload-id': uploadId,
            'x-content-type': 'video/mp4',
            'x-allow-overwrite': '1',
            'content-type': 'application/json',
        }, Buffer.from(JSON.stringify(parts)));

        if (completeResult.error) {
            return { error: `Failed to complete multipart upload: ${stringifyError(completeResult.error)}` };
        }

        debugLog(`Multipart upload complete: ${completeResult.url}`);
        return completeResult;
    } finally {
        try { fs.closeSync(fileHandle); } catch {}
    }
}

function stringifyError(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    try { return JSON.stringify(err); } catch { return String(err); }
}

function blobApiRequest(method, pathname, token, extraHeaders, body) {
    return new Promise((resolve) => {
        const headers = {
            'authorization': `Bearer ${token}`,
            'x-api-version': '12',
            ...extraHeaders,
        };

        const options = {
            hostname: 'blob.vercel-storage.com',
            port: 443,
            path: `/mpu?pathname=${encodeURIComponent(pathname)}`,
            method,
            headers,
        };

        debugLog(`Blob API ${method} ${options.path} headers: ${JSON.stringify(Object.keys(extraHeaders))}`);

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                debugLog(`Blob API response (${res.statusCode}): ${data.substring(0, 300)}`);
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 400) {
                        resolve({ error: stringifyError(json.error || json.message) || `HTTP ${res.statusCode}: ${data.substring(0, 200)}` });
                    } else {
                        resolve(json);
                    }
                } catch {
                    resolve({ error: `Blob API error (${res.statusCode}): ${data.substring(0, 200)}` });
                }
            });
        });
        req.on('error', (e) => resolve({ error: e.message }));
        req.setTimeout(120000, () => { req.destroy(); resolve({ error: 'Request timed out' }); });
        if (body) req.write(body);
        req.end();
    });
}

// ── Debug logging (to renderer console) ──

function debugLog(message) {
    if (mainWindow) {
        try {
            mainWindow.webContents.executeJavaScript(
                `console.log('%c[Theta Main]', 'color: #f25b46', ${JSON.stringify(String(message))});`
            );
        } catch {}
    }
}

// ── Resolve API ──

async function initResolve() {
    const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!ok) return null;
    resolveObj = await WorkflowIntegration.GetResolve();
    return resolveObj;
}

async function getResolve() {
    if (!resolveObj) resolveObj = await initResolve();
    return resolveObj;
}

async function getProjectManager() {
    if (!projectManagerObj) {
        const resolve = await getResolve();
        if (resolve) projectManagerObj = await resolve.GetProjectManager();
    }
    return projectManagerObj;
}

async function getCurrentProject() {
    const pm = await getProjectManager();
    return pm ? await pm.GetCurrentProject() : null;
}

// ── IPC Handlers ──

function registerHandlers() {
    // Auth
    ipcMain.handle('auth:login', async (e, name, password) => {
        const config = loadConfig();
        const result = await portalRequest('POST', '/api/auth/login', { name, password }, config);
        if (!result.error) {
            config.jira_user = result.user || name;
            config.display_name = result.displayName || result.user || name;
            config.auth_token = result.token || '';
            config.watcher_secret = result.secret || config.watcher_secret || '';
            saveConfig(config);
        }
        return result;
    });

    ipcMain.handle('auth:logout', async () => {
        const config = loadConfig();
        // Revoke the token server-side so it can't be reused if config.json is compromised
        if (config.auth_token) {
            await portalRequest('POST', '/api/auth/revoke-token', { token: config.auth_token }, config, 10000)
                .catch(() => {}); // Non-fatal — clear locally regardless
        }
        config.auth_token = '';
        config.jira_user = '';
        config.display_name = '';
        saveConfig(config);
        return { status: 'logged_out' };
    });

    ipcMain.handle('auth:status', async () => {
        const config = loadConfig();
        return {
            logged_in: !!config.auth_token,
            user: config.jira_user || '',
            display_name: config.display_name || config.jira_user || '',
        };
    });

    // Health
    ipcMain.handle('health', async () => {
        const resolve = await getResolve();
        const config = loadConfig();
        return {
            resolve_connected: !!resolve,
            logged_in: !!config.auth_token,
        };
    });

    // Reviews (primary data source — not Jira directly)
    ipcMain.handle('reviews:list', async () => {
        const config = loadConfig();
        // Cache-bust to bypass Vercel edge cache when refreshing after changes
        return portalRequest('GET', `/api/reviews/active?_=${Date.now()}`, null, config);
    });

    ipcMain.handle('reviews:get', async (e, token) => {
        const config = loadConfig();
        return portalRequest('GET', `/api/review/${token}`, null, config);
    });

    // Deliverables
    ipcMain.handle('deliverables:add', async (e, jiraKey, label) => {
        const config = loadConfig();
        return portalRequest('POST', '/api/reviews/add-deliverable', {
            jiraKey,
            label,
            secret: config.watcher_secret || undefined,
        }, config);
    });

    ipcMain.handle('deliverables:delete', async (e, deliverableId) => {
        const config = loadConfig();
        return portalRequest('POST', '/api/reviews/delete-deliverable', {
            deliverableId,
            secret: config.watcher_secret || undefined,
        }, config);
    });

    ipcMain.handle('deliverables:rename', async (e, deliverableId, newLabel) => {
        const config = loadConfig();
        return portalRequest('POST', '/api/reviews/rename-deliverable', {
            deliverableId,
            newLabel,
            secret: config.watcher_secret || undefined,
        }, config);
    });

    ipcMain.handle('tasks:claim', async (e, jiraKey) => {
        const config = loadConfig();
        return portalRequest('POST', '/api/jira/claim-task', {
            jiraKey,
            user: config.jira_user,
        }, config);
    });

    // Timeline
    ipcMain.handle('resolve:getTimeline', async () => {
        const project = await getCurrentProject();
        if (!project) return { error: 'No project open' };
        const timeline = await project.GetCurrentTimeline();
        if (!timeline) return { error: 'No timeline open' };
        return {
            name: await timeline.GetName(),
            duration: (await timeline.GetEndFrame()) - (await timeline.GetStartFrame()),
            framerate: await timeline.GetSetting('timelineFrameRate'),
        };
    });

    // Render
    ipcMain.handle('resolve:startRender', async (e, jiraKey, version, presetName, label) => {
        const config = loadConfig();
        const project = await getCurrentProject();
        if (!project) return { error: 'No project open' };

        const timeline = await project.GetCurrentTimeline();
        if (!timeline) return { error: 'No timeline open' };

        const preset = PRESETS[presetName || config.render_preset || 'review'] || PRESETS.review;
        const outputDir = resolveOutputDir(config);

        try { fs.mkdirSync(outputDir, { recursive: true }); } catch {}

        // Include a sanitized label in the filename so multiple deliverables
        // on the same review get unique filenames (e.g. PROD-133_Office-Tour_v1.mp4).
        const safeLabel = label
            ? '_' + label.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').substring(0, 30)
            : '';
        const filename = `${jiraKey}${safeLabel}_v${version}`;
        const expectedOutputPath = path.join(outputDir, `${filename}.mp4`);
        debugLog(`Render will write to: ${expectedOutputPath}`);

        // Set render settings (format + output) — matches sample plugin approach
        const settingsOk = await project.SetRenderSettings({
            TargetDir: outputDir,
            CustomName: filename,
            FormatWidth: preset.width,
            FormatHeight: preset.height,
        });

        debugLog(`SetRenderSettings result: ${settingsOk}`);

        // Add the render job — returns a job ID
        const jobId = await project.AddRenderJob();
        if (!jobId) {
            return { error: 'Failed to add render job — check render settings in Resolve' };
        }

        currentRenderJobId = jobId;
        debugLog(`AddRenderJob returned jobId: ${jobId}`);

        // Register the RenderStop callback to detect completion
        WorkflowIntegration.RegisterCallback('RenderStop', () => {
            debugLog('RenderStop callback fired');
            if (mainWindow) {
                mainWindow.webContents.send('render:stopped');
            }
        });

        // Start rendering with the specific job ID (as sample plugin does)
        const startOk = await project.StartRendering(jobId);
        debugLog(`StartRendering result: ${startOk}`);

        if (!startOk) {
            return { error: 'Failed to start rendering' };
        }

        return {
            status: 'started',
            output_path: path.join(outputDir, `${filename}.mp4`),
            job_id: jobId,
            settings: {
                resolution: `${preset.width}x${preset.height}`,
                bitrate: preset.bitrate,
            },
        };
    });

    ipcMain.handle('resolve:getRenderProgress', async () => {
        const project = await getCurrentProject();
        if (!project) return { progress: -1, status: 'No project' };

        // Use IsRenderingInProgress as the primary check
        let isRendering = false;
        try {
            isRendering = await project.IsRenderingInProgress();
        } catch (e) {
            debugLog(`IsRenderingInProgress error: ${e}`);
        }

        // Try to get job status for progress percentage
        let pct = 0;
        let jobStatus = isRendering ? 'Rendering' : 'Unknown';
        let eta = '';

        try {
            const count = await project.GetRenderJobCount();
            if (count && count > 0) {
                const rawStatus = await project.GetRenderJobStatus(count - 1);
                debugLog(`Raw status keys: ${rawStatus ? Object.keys(rawStatus).join(', ') : 'null'}`);
                debugLog(`Raw status: ${JSON.stringify(rawStatus)}`);

                if (rawStatus && typeof rawStatus === 'object') {
                    // Extract percentage — try every possible key
                    for (const key of Object.keys(rawStatus)) {
                        const lk = key.toLowerCase();
                        if (lk.includes('completion') || lk.includes('percent') || lk.includes('progress')) {
                            pct = rawStatus[key];
                            break;
                        }
                    }
                    // Extract status
                    for (const key of Object.keys(rawStatus)) {
                        const lk = key.toLowerCase();
                        if (lk.includes('status') || lk.includes('job')) {
                            if (typeof rawStatus[key] === 'string') {
                                jobStatus = rawStatus[key];
                                break;
                            }
                        }
                    }
                    // Extract ETA
                    for (const key of Object.keys(rawStatus)) {
                        const lk = key.toLowerCase();
                        if (lk.includes('time') || lk.includes('eta') || lk.includes('remain')) {
                            eta = rawStatus[key];
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            debugLog(`GetRenderJobStatus error: ${e}`);
        }

        if (!isRendering) {
            const failed = jobStatus.toLowerCase().includes('fail')
                || jobStatus.toLowerCase().includes('error')
                || jobStatus.toLowerCase().includes('cancel');
            return {
                progress: failed ? pct : 100,
                status: failed ? jobStatus : 'Complete',
                time_remaining: '',
            };
        }

        return { progress: pct, status: 'Rendering', time_remaining: String(eta) };
    });

    ipcMain.handle('resolve:cancelRender', async () => {
        const project = await getCurrentProject();
        if (project) await project.StopRendering();
        currentRenderJobId = null;
        return { status: 'cancelled' };
    });

    // Comments
    ipcMain.handle('comments:list', async (e, reviewToken, deliverableId) => {
        const config = loadConfig();
        return portalRequest('GET', `/api/review/${reviewToken}/comments?deliverableId=${deliverableId}`, null, config);
    });

    ipcMain.handle('comments:setAddressed', async (e, reviewToken, commentId, addressed) => {
        const config = loadConfig();
        return portalRequest('POST', `/api/review/${reviewToken}/comments/${commentId}/addressed`, {
            addressed,
            secret: config.watcher_secret || undefined,
        }, config);
    });

    // Timeline seek
    ipcMain.handle('resolve:seekToTimecode', async (e, timecode) => {
        const project = await getCurrentProject();
        if (!project) return { error: 'No project open' };
        const timeline = await project.GetCurrentTimeline();
        if (!timeline) return { error: 'No timeline open' };
        try {
            const ok = await timeline.SetCurrentTimecode(timecode);
            return ok ? { status: 'ok' } : { error: 'Failed to seek' };
        } catch (err) {
            return { error: `Seek failed: ${err}` };
        }
    });

    // Upload
    ipcMain.handle('upload', async (e, filePath, jiraKey, label, reviewToken) => {
        const config = loadConfig();
        return uploadFile(filePath, jiraKey, config, label, reviewToken);
    });

    // Config
    ipcMain.handle('config:get', async () => {
        const config = loadConfig();
        const safe = { ...config };
        delete safe.watcher_secret;
        delete safe.auth_token;
        safe.has_secret = !!config.watcher_secret;
        return safe;
    });

    ipcMain.handle('config:save', async (e, updates) => {
        const config = loadConfig();
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'render_preset' && typeof value === 'string' && PRESETS[value]) {
                config.render_preset = value;
            } else if (key in config && key !== 'auth_token' && key !== 'watcher_secret') {
                config[key] = value;
            }
        }
        saveConfig(config);
        return { status: 'saved' };
    });

    // Cleanup
    ipcMain.handle('cleanup', async () => {
        WorkflowIntegration.CleanUp();
        resolveObj = null;
        projectManagerObj = null;
        return true;
    });
}

// ── Window ──

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 340,
        height: 700,
        title: 'Theta Review',
        icon: path.join(__dirname, 'img', 'icon.png'),
        useContentSize: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    mainWindow.setMenu(null);

    // Set macOS dock icon
    if (process.platform === 'darwin' && app.dock) {
        try { app.dock.setIcon(path.join(__dirname, 'img', 'icon.png')); } catch {}
    }
    mainWindow.on('close', () => app.quit());
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    registerHandlers();
    createWindow();
    // Delay version check so it doesn't block the window appearing
    setTimeout(checkPortalVersion, 3000);
});

function currentPluginVersion() {
    try {
        const manifest = fs.readFileSync(path.join(__dirname, 'manifest.xml'), 'utf8');
        const m = manifest.match(/<Version>(.*?)<\/Version>/);
        return m ? m[1] : '0.0.0';
    } catch { return '0.0.0'; }
}

function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
}

async function checkPortalVersion() {
    try {
        const config = loadConfig();
        if (!config.portal_url) return;

        const res = await fetch(`${config.portal_url}/api/plugin/version`);
        if (!res.ok) return;
        const { version: latest, downloads } = await res.json();
        const current = currentPluginVersion();

        if (compareVersions(latest, current) > 0) {
            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Available',
                message: `Theta Review ${latest} is available (you have ${current}).`,
                detail: 'Download and install now? Resolve will need to be restarted after.',
                buttons: ['Update Now', 'Later'],
                defaultId: 0,
            });
            if (response === 0) {
                const url = process.platform === 'win32' ? downloads?.win : downloads?.mac;
                if (url) {
                    await downloadAndInstall(latest, url);
                } else {
                    shell.openExternal('https://github.com/Theta-State-Studios/theta-resolve-plugin/releases/latest');
                }
            }
        }
    } catch {
        // Silently ignore — offline, portal unreachable, etc.
    }
}

async function downloadAndInstall(version, url) {
    const isWin = process.platform === 'win32';
    const ext      = isWin ? 'exe' : 'pkg';
    const platform = isWin ? 'windows' : 'mac';
    const filename = `ThetaReview-v${version}-${platform}.${ext}`;
    const destDir  = isWin ? os.tmpdir() : path.join(os.homedir(), 'Downloads');
    const destPath = path.join(destDir, filename);

    try {
        // Show a non-blocking downloading notice via the window title
        if (mainWindow) mainWindow.setTitle('Theta Review — Downloading update…');

        await downloadFile(url, destPath);

        if (mainWindow) mainWindow.setTitle('Theta Review');

        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Ready to Install',
            message: 'Download complete.',
            detail: 'The installer will open now. Restart DaVinci Resolve after it finishes.',
            buttons: ['Open Installer'],
        });

        shell.openPath(destPath);
    } catch {
        if (mainWindow) mainWindow.setTitle('Theta Review');
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Download Failed',
            message: 'Could not download the update.',
            detail: 'You can download it manually from the releases page.',
            buttons: ['Open Releases Page', 'Cancel'],
        });
        if (response === 0) {
            shell.openExternal('https://github.com/Theta-State-Studios/theta-resolve-plugin/releases/latest');
        }
    }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);

        function doRequest(requestUrl) {
            const lib = requestUrl.startsWith('https') ? https : http;
            lib.get(requestUrl, { headers: { 'User-Agent': 'theta-review-plugin' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    doRequest(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlink(destPath, () => {});
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
            }).on('error', (err) => {
                file.close();
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }

        doRequest(url);
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
