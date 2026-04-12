# Theta Review — DaVinci Resolve Plugin

## Overview
A Workflow Integration Plugin for DaVinci Resolve that allows editors to browse their assigned tasks, render review proxies with correct settings, and upload directly to the Theta Review Portal — all without leaving Resolve.

## Tech Stack
- **Plugin UI**: HTML/CSS/JS (rendered in Resolve's embedded Chromium browser)
- **Resolve API Bridge**: Python script using DaVinci Resolve Scripting API
- **Backend Communication**: HTTP calls to the Theta Review Portal API
- **Configuration**: JSON config file for user settings

## Architecture

```
┌─────────────────────────────────────────────────┐
│  DaVinci Resolve                                 │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Theta Review Panel (HTML/CSS/JS)         │   │
│  │  - Client list with task drill-down       │   │
│  │  - Upload controls                        │   │
│  │  - Render progress                        │   │
│  │  - Review status display                  │   │
│  └──────────┬───────────────────────────────┘   │
│             │ JavaScript ↔ Python bridge         │
│  ┌──────────▼───────────────────────────────┐   │
│  │  Python Backend Script                    │   │
│  │  - Resolve Scripting API (render, etc.)   │   │
│  │  - HTTP client for Review Portal API      │   │
│  │  - File upload to Vercel Blob             │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
          │
          │ HTTPS
          ▼
┌─────────────────────────────────────────────────┐
│  Theta Review Portal (review.theta-studios.com)  │
│                                                  │
│  GET  /api/jira/active-tasks     → task list     │
│  POST /api/upload/create-review  → upload video  │
│  POST /api/watcher/upload        → create review │
│  GET  /api/review/[token]        → review data   │
└─────────────────────────────────────────────────┘
```

## Plugin Installation

DaVinci Resolve Workflow Integration Plugins live in:
- **macOS**: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/`
- **Windows**: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\`
- **Linux**: `/opt/resolve/Workflow Integration Plugins/`

Plugin structure:
```
Theta Review/
├── manifest.xml          ← Plugin registration (name, version, panel config)
├── index.html            ← Main panel UI
├── css/
│   └── style.css         ← Panel styling (dark theme matching Resolve)
├── js/
│   ├── app.js            ← Main panel logic
│   ├── api.js            ← Review Portal API client
│   └── resolve-bridge.js ← Communication with Python backend
├── python/
│   ├── main.py           ← Python backend (Resolve API + HTTP)
│   ├── render.py         ← Render preset configuration and execution
│   ├── upload.py         ← File upload to Vercel Blob + Portal API
│   └── config.py         ← User configuration management
└── config.json           ← User settings (API URL, credentials, etc.)
```

## manifest.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<WorkflowIntegrationPlugin>
    <Identity>
        <Name>Theta Review</Name>
        <Id>com.theta-studios.review</Id>
        <Version>1.0.0</Version>
        <Description>Upload review proxies to the Theta Review Portal</Description>
    </Identity>
    <UI>
        <Panel>
            <Id>com.theta-studios.review.panel</Id>
            <Name>Theta Review</Name>
            <Page>index.html</Page>
            <FixedSize>false</FixedSize>
            <MinWidth>300</MinWidth>
            <MinHeight>400</MinHeight>
        </Panel>
    </UI>
</WorkflowIntegrationPlugin>
```

## Configuration (config.json)

```json
{
  "portal_url": "https://review.theta-studios.com",
  "auth_token": "",
  "watcher_secret": "",
  "jira_user": "",
  "display_name": "",
  "render_preset": {
    "format": "MP4",
    "codec": "H.264",
    "resolution": "1920x1080",
    "bitrate": 10000000,
    "audio_codec": "AAC",
    "audio_bitrate": 320000
  },
  "output_dir": "/tmp/theta-review-exports",
  "keep_local_copy": false
}
```

The `auth_token`, `watcher_secret`, `jira_user`, and `display_name` fields are populated automatically on login and cleared on logout. The user never sets these manually.

## UI Screens & Navigation

### Login Screen

Shown on first launch (no stored auth token). The editor signs in with their portal name and password.

```
┌─────────────────────────────┐
│                             │
│       Theta Review          │
│  Sign in to your portal     │
│        account              │
│                             │
│  NAME                       │
│  [Your name              ]  │
│                             │
│  PASSWORD                   │
│  [••••••••               ]  │
│                             │
│  [       Sign In          ] │
│                             │
└─────────────────────────────┘
```

**Behavior**:
- On success → store token + user info in config.json, navigate to Client List
- On failure → show error message inline
- On subsequent launches → skip to Client List if token exists

### Screen 1: Client List (Home)

The default view after login. Shows clients the editor has tasks for, grouped with task counts.

```
┌─────────────────────────────┐
│  Theta Review     [Settings]│
│─────────────────────────────│
│  🔍 Search clients...      │
│                             │
│  Your Friends Farm          │
│  3 tasks · 2 editing        │
│                             │
│  Perrenoud Roofing          │
│  1 task · 1 waiting         │
│                             │
│  Brio Tiny Homes            │
│  2 tasks · 1 in review      │
│                             │
└─────────────────────────────┘
```

**Data source**: `GET /api/reviews/active` → group by client name from review data

**Behavior**:
- Search bar filters clients by name as you type
- Click a client → navigate to Screen 2
- Settings icon → navigate to Screen 4
- Badge shows task count and how many are in active editing status

### Screen 2: Client Tasks

Shows all PROD tasks for the selected client with their deliverables. Status filter chips at the top allow filtering by task status.

```
┌─────────────────────────────┐
│  ← Your Friends Farm        │
│─────────────────────────────│
│ [All 3] [Waiting 1] [Edit 2]│
│─────────────────────────────│
│                             │
│  PROD-132 · Brand Film      │
│  ● Editing · v0             │
│  [Upload Current Timeline]  │
│                             │
│  PROD-133 · Reels           │
│  ● Editing · v1             │
│  ├ Office Tour Reel  v1     │
│  ├ Team Intro Reel   v1     │
│  └ [+ Add Deliverable]      │
│                             │
│  PROD-134 · Cooking Class   │
│  ○ Waiting · v0             │
│  [Start Editing]            │
│                             │
└─────────────────────────────┘
```

**Data source**: Same reviews API, filtered to client. Each review already contains its Jira key, deliverables, and version info.

**Behavior**:
- Back arrow → return to Screen 1
- Status filter chips: show counts per status, filter the task list when clicked
- Status dots: ○ Waiting (gray), ● Editing (white), ● In Review (yellow), ● Needs Edits (red), ● Approved (green)
- "Start Editing" (waiting tasks only) → calls `POST /api/jira/claim-task` to assign task and move to editing
- "Upload Current Timeline" → starts render + upload flow (Screen 3)
  - Uses current timeline in Resolve
  - For v0 tasks: creates first version
  - For existing tasks: creates new version (v1 → v2)
- Multi-deliverable tasks show existing deliverables with versions
- "Upload New Version" on a specific deliverable → renders and replaces that deliverable's video
- "+ Add Deliverable" → prompts for label, then renders and adds to the review link
- Click task name → opens review link in default browser

### Screen 3: Render & Upload Progress

Shows during the render and upload process.

```
┌─────────────────────────────┐
│  Uploading to PROD-132      │
│─────────────────────────────│
│                             │
│  Step 1: Rendering          │
│  ████████████░░░░░  67%     │
│  1080p H.264 · 10 Mbps     │
│  ETA: 1m 23s                │
│                             │
│  Step 2: Uploading          │
│  (waiting for render)       │
│                             │
│  Step 3: Updating portal    │
│  (waiting)                  │
│                             │
│  [Cancel]                   │
└─────────────────────────────┘
```

**Steps**:

1. **Render**
   - Set render format via Resolve API: `project.SetCurrentRenderFormatAndCodec("mp4", "H264_NVIDIA")` or CPU fallback
   - Set render settings: resolution 1920x1080, bitrate from config
   - Set output filename: `{PROD_KEY}_v{VERSION}.mp4` in the configured output directory
   - Start render: `project.StartRendering()`
   - Poll `project.GetRenderJobStatus()` for progress updates
   - Display progress bar with percentage and ETA

2. **Upload**
   - Read the rendered file
   - Upload to Vercel Blob via the Review Portal API (`POST /api/upload/create-review` with multipart form data)
   - Show upload progress (if possible with streaming upload)

3. **Update Portal**
   - The upload API already handles: creating/updating the deliverable, creating the review link, updating Jira status and fields
   - Display the result (review URL, Jira status change)

**On completion** → navigate to Screen 3b (success)
**On cancel** → abort render, return to Screen 2
**On error** → show error message with retry option

### Screen 3b: Upload Complete

```
┌─────────────────────────────┐
│  ✓ Upload Complete          │
│─────────────────────────────│
│                             │
│  PROD-132 · Brand Film      │
│  Version: v1                │
│  Status: In Review          │
│                             │
│  Review Link:               │
│  review.theta-studios.com/  │
│  review/abc123...           │
│                             │
│  [Open Review]  [Copy Link] │
│                             │
│  Jira updated:              │
│  ✓ Status → Internal Review │
│  ✓ Review link field set    │
│  ✓ Comment posted           │
│                             │
│  [← Back to Tasks]          │
└─────────────────────────────┘
```

### Screen 4: Settings

```
┌─────────────────────────────┐
│  ← Settings                 │
│─────────────────────────────│
│                             │
│  ACCOUNT                    │
│  Eli              [Log Out] │
│                             │
│  Export Quality              │
│  ○ Proxy (720p · 5 Mbps)   │
│  ● Review (1080p · 10 Mbps) │
│  ○ High (1080p · 20 Mbps)  │
│                             │
│  Keep local copies          │
│  [Toggle: Off]              │
│                             │
│  Output folder              │
│  [/tmp/theta-exports]       │
│                             │
│  [Save]                     │
└─────────────────────────────┘
```

## Python Backend (main.py)

The Python script runs alongside the HTML panel and provides:

### Resolve API Functions

```python
import DaVinciResolveScript as dvr

resolve = dvr.scriptapp("Resolve")
project_manager = resolve.GetProjectManager()
project = project_manager.GetCurrentProject()

def get_current_timeline():
    """Get the currently active timeline name and metadata."""
    timeline = project.GetCurrentTimeline()
    return {
        "name": timeline.GetName(),
        "duration": timeline.GetEndFrame() - timeline.GetStartFrame(),
        "framerate": timeline.GetSetting("timelineFrameRate"),
    }

def set_render_preset(config):
    """Configure render settings for review proxy export."""
    project.SetCurrentRenderFormatAndCodec("mp4", "H264")
    project.SetRenderSettings({
        "TargetDir": config["output_dir"],
        "CustomName": f"{config['filename']}",
        "FormatWidth": 1920,
        "FormatHeight": 1080,
        "VideoBitRate": config["bitrate"],
        "AudioCodec": "aac",
        "AudioBitRate": config["audio_bitrate"],
        "ExportVideo": True,
        "ExportAudio": True,
    })

def start_render():
    """Add current timeline to render queue and start rendering."""
    project.AddRenderJob()
    project.StartRendering()

def get_render_progress():
    """Poll render progress. Returns 0-100 or -1 if not rendering."""
    status = project.GetRenderJobStatus(project.GetRenderJobCount() - 1)
    if status:
        return {
            "progress": status.get("CompletionPercentage", 0),
            "status": status.get("JobStatus", "Unknown"),
            "time_remaining": status.get("TimeTakenToRender", ""),
        }
    return {"progress": -1, "status": "Not rendering"}

def cancel_render():
    """Stop the current render."""
    project.StopRendering()
```

### HTTP Client Functions (upload.py)

```python
import requests
import os

def upload_to_portal(file_path, jira_key, config, label=None):
    """Upload rendered file to the Review Portal."""
    url = f"{config['portal_url']}/api/upload/create-review"

    with open(file_path, "rb") as f:
        files = {"file": (os.path.basename(file_path), f, "video/mp4")}
        data = {"jiraKey": jira_key}
        if label:
            data["label"] = label

        response = requests.post(url, files=files, data=data)

    return response.json()

def get_tasks(config):
    """Fetch active PROD tasks from the Review Portal."""
    url = f"{config['portal_url']}/api/jira/active-tasks"
    response = requests.get(url)
    return response.json()

def get_review_data(token, config):
    """Fetch review data for a specific token."""
    url = f"{config['portal_url']}/api/review/{token}"
    response = requests.get(url)
    return response.json()
```

### JavaScript ↔ Python Bridge

Resolve plugins communicate between the HTML UI and Python using a local HTTP server or Resolve's built-in bridge. The recommended approach:

```python
# In main.py — start a local HTTP server for the HTML panel to call
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading

class PluginHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/timeline":
            data = get_current_timeline()
            self.send_json(data)
        elif self.path.startswith("/api/tasks"):
            data = get_tasks(config)
            self.send_json(data)

    def do_POST(self):
        if self.path == "/api/render":
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            set_render_preset(body)
            start_render()
            self.send_json({"status": "started"})
        elif self.path == "/api/upload":
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            result = upload_to_portal(body["file_path"], body["jira_key"], config)
            self.send_json(result)
        elif self.path == "/api/render/progress":
            data = get_render_progress()
            self.send_json(data)
        elif self.path == "/api/render/cancel":
            cancel_render()
            self.send_json({"status": "cancelled"})

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

# Start server on a random available port
server = HTTPServer(("127.0.0.1", 0), PluginHandler)
port = server.server_address[1]
# Write port to a file so the HTML panel knows where to connect
with open("bridge_port.txt", "w") as f:
    f.write(str(port))
threading.Thread(target=server.serve_forever, daemon=True).start()
```

```javascript
// In js/resolve-bridge.js — HTML panel calls the Python backend
class ResolveBridge {
    constructor() {
        this.port = null;
    }

    async init() {
        // Read the port from the bridge file
        const response = await fetch("bridge_port.txt");
        this.port = (await response.text()).trim();
    }

    async getTimeline() {
        const res = await fetch(`http://127.0.0.1:${this.port}/api/timeline`);
        return res.json();
    }

    async startRender(config) {
        const res = await fetch(`http://127.0.0.1:${this.port}/api/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        return res.json();
    }

    async getRenderProgress() {
        const res = await fetch(`http://127.0.0.1:${this.port}/api/render/progress`, {
            method: "POST",
        });
        return res.json();
    }

    async upload(filePath, jiraKey) {
        const res = await fetch(`http://127.0.0.1:${this.port}/api/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: filePath, jira_key: jiraKey }),
        });
        return res.json();
    }
}
```

## Panel Styling

The panel should match Resolve's dark UI:

```css
:root {
    --bg-primary: #1a1a1a;      /* Resolve's main background */
    --bg-secondary: #242424;     /* Card/panel backgrounds */
    --bg-hover: #2a2a2a;        /* Hover state */
    --text-primary: #cccccc;     /* Main text */
    --text-secondary: #888888;   /* Muted text */
    --accent: #f25b46;           /* Theta orange-red */
    --success: #34d399;
    --warning: #fbbf24;
    --danger: #f25b46;
    --border: #333333;
    --radius: 4px;               /* Resolve uses subtle rounding */
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

## Implementation Phases

### Phase 1: Foundation
- Set up plugin directory structure and manifest.xml
- Basic HTML panel that loads in Resolve
- Python backend with local HTTP server bridge
- Verify Resolve Scripting API access works from the plugin context
- Config file loading and settings screen

### Phase 2: Task Display
- Fetch tasks from Review Portal API
- Group by client name
- Client list view with search
- Client drill-down to task list
- Status indicators and version info
- For tasks with review links, fetch deliverable details

### Phase 3: Render & Upload
- Configure render preset via Resolve API
- Start render and monitor progress
- Upload rendered file to Review Portal API
- Handle completion (show review link, copy, open in browser)
- Handle errors and cancellation
- Auto-set status to "In Review" after upload

### Phase 4: Multi-Deliverable Support
- Show existing deliverables for multi-reel tasks
- "Upload New Version" for existing deliverables
- "+ Add Deliverable" for new reels
- Label input for new deliverables
- Timeline name auto-detection for matching

### Phase 5: Polish
- Upload progress indicator
- Local file cleanup (optional keep copies)
- Notification when upload completes (even if Resolve is in background)
- Error recovery and retry logic
- GPU vs CPU codec detection and fallback

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/login` | Authenticate with name/password, returns token + user info |
| GET | `/api/reviews/active` | Fetch all active reviews (primary data source for task list) |
| GET | `/api/review/[token]` | Get review data (deliverables, versions) |
| POST | `/api/jira/claim-task` | Assign a waiting task to the user and move to post-production |
| POST | `/api/upload/create-review` | Upload video file(s) and create/update review |
| POST | `/api/watcher/upload` | Alternative upload endpoint (used by file watcher) |
| POST | `/api/review/[token]/status` | Update review status |

## Render Presets

| Preset | Resolution | Codec | Bitrate | Use Case |
|--------|-----------|-------|---------|----------|
| Proxy | 1280x720 | H.264 | 5 Mbps | Quick reviews, mobile viewing |
| Review | 1920x1080 | H.264 | 5 Mbps | Standard review quality |
| High | 1920x1080 | H.264 | 20 Mbps | Detail-critical reviews (color, VFX) |

All presets output MP4 with AAC audio at 320 kbps. The default is "Review" (1080p 10 Mbps) which stays under Vercel Blob's 512 MB cache threshold for videos up to ~7 minutes.

## Authentication

On first launch, the plugin shows a login screen where the editor signs in with their portal name and password. The portal returns:

```json
{
  "user": "eli",
  "displayName": "Eli",
  "token": "auth-token-here",
  "secret": "watcher-secret-here"
}
```

The token, user info, and watcher secret are stored in `config.json`. Subsequent launches check for a stored token and skip the login screen. The user can log out from Settings.

For uploads, the plugin authenticates using the `secret` returned at login (same `WATCHER_SECRET` used by the file watcher).

## Claiming Tasks

Editors can claim tasks that are in "Waiting" status by clicking "Start Editing" in the task list. This calls `POST /api/jira/claim-task` with `{ jiraKey, user }` which:

1. Assigns the Jira task to the editor
2. Transitions the task status to post-production/editing
3. Returns `{ status: "claimed" }`

## Error Handling

- **Resolve not running**: Panel shows "Connect to Resolve" message
- **No timeline open**: "Open a timeline to start" message
- **API unreachable**: "Cannot reach Review Portal — check your connection" with retry button
- **Render fails**: Show Resolve's error message, offer to retry with different settings
- **Upload fails**: Keep the rendered file, offer to retry upload without re-rendering
- **Disk full**: Check available space before starting render

## Future Enhancements

- Thumbnail generation from the current frame for the review link
- Comment viewer — see review comments directly in the panel without opening a browser
- Auto-detect PROD task from timeline metadata or project name
- Batch render/upload multiple timelines
- Integration with Resolve's notification system
- Marker import — convert review comments with timecodes to Resolve timeline markers
