const { contextBridge, ipcRenderer } = require('electron/renderer');

// Forward render:stopped event from main → renderer window
ipcRenderer.on('render:stopped', () => {
    window.dispatchEvent(new CustomEvent('theta:renderStopped'));
});

// Forward upload:progress messages from main → renderer
ipcRenderer.on('upload:progress', (_e, message) => {
    window.dispatchEvent(new CustomEvent('theta:uploadProgress', { detail: message }));
});

contextBridge.exposeInMainWorld('theta', {
    // Auth
    login: (name, password) => ipcRenderer.invoke('auth:login', name, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getAuthStatus: () => ipcRenderer.invoke('auth:status'),

    // Health
    health: () => ipcRenderer.invoke('health'),

    // Reviews
    getReviews: () => ipcRenderer.invoke('reviews:list'),
    getReviewData: (token) => ipcRenderer.invoke('reviews:get', token),
    claimTask: (jiraKey) => ipcRenderer.invoke('tasks:claim', jiraKey),

    // Resolve
    getTimeline: () => ipcRenderer.invoke('resolve:getTimeline'),
    startRender: (jiraKey, version, preset, label) => ipcRenderer.invoke('resolve:startRender', jiraKey, version, preset, label),
    getRenderProgress: () => ipcRenderer.invoke('resolve:getRenderProgress'),
    cancelRender: () => ipcRenderer.invoke('resolve:cancelRender'),

    // Upload
    upload: (filePath, jiraKey, label, reviewToken) => ipcRenderer.invoke('upload', filePath, jiraKey, label, reviewToken),

    // Deliverables
    addDeliverable: (jiraKey, label) => ipcRenderer.invoke('deliverables:add', jiraKey, label),
    deleteDeliverable: (deliverableId) => ipcRenderer.invoke('deliverables:delete', deliverableId),
    renameDeliverable: (deliverableId, newLabel) => ipcRenderer.invoke('deliverables:rename', deliverableId, newLabel),

    // Comments
    getComments: (reviewToken, deliverableId) => ipcRenderer.invoke('comments:list', reviewToken, deliverableId),
    setCommentAddressed: (reviewToken, commentId, addressed) => ipcRenderer.invoke('comments:setAddressed', reviewToken, commentId, addressed),

    // Timeline seek
    seekToTimecode: (timecode) => ipcRenderer.invoke('resolve:seekToTimecode', timecode),

    // Config
    getConfig: () => ipcRenderer.invoke('config:get'),
    saveConfig: (updates) => ipcRenderer.invoke('config:save', updates),

    // Cleanup
    cleanup: () => ipcRenderer.invoke('cleanup'),
});
