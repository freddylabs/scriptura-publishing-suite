/**
 * The Gospel Appraisal — app shell
 */

const AppState = {
  activeTab: 'studio',
  currentTranscript: null,
  currentBook: null,
  activeChapterIndex: 0,
  readerCurrentPage: 0,
  readerTheme: 'theme-white',
  mediaFile: null,
  mediaBlobUrl: null,
  mediaIsVideo: false,
  mediaObjectUrl: null,
  sessionId: null
};

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const SESSION_STORAGE_KEY = 'tga-work-session';

const TAB_COPY = {
  studio: { kicker: 'Media / Studio', title: 'Upload & transcribe' },
  highlights: { kicker: 'Media / Clips', title: 'Select text, cut clips' },
  editor: { kicker: 'Files / Manuscript', title: 'Manuscript in your voice' },
  reader: { kicker: 'Files / Reader', title: 'Read the spread' },
  cover: { kicker: 'Files / Cover', title: 'Cover' },
  services: { kicker: 'Share / Publish', title: 'Publish' }
};

document.addEventListener('DOMContentLoaded', async () => {
  getSessionId();
  initNavigation();
  initFinishButton();
  initNewUploadButton();
  initGlobalSearch();
  TranscribeModule.init();
  HighlightsModule.init();
  TransformerModule.init();
  BookViewerModule.init();
  ExportModule.init();
  resetWorkspace({ silent: true });
  logActivity('Workspace is clear. Upload a recording to begin.');
});

function getSessionId() {
  if (AppState.sessionId) return AppState.sessionId;
  let id = null;
  try {
    id = localStorage.getItem(SESSION_STORAGE_KEY);
  } catch (e) {
    id = null;
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, id);
    } catch (e) {
      // private mode
    }
  }
  AppState.sessionId = id;
  return id;
}

function initFinishButton() {
  const btn = document.getElementById('btn-finish-discard');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ok = window.confirm('Delete your uploaded recording and server clips from this session? Downloads already on your computer are kept.');
    if (!ok) return;
    await prepareForNewUpload({ silent: true });
    showToast('Your recording was deleted from the server.', 'success');
    logActivity('Session files discarded.');
  });
}

function initNewUploadButton() {
  const btn = document.getElementById('btn-new-upload');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await prepareForNewUpload({ silent: true });
    showToast('Workspace cleared. Upload a new audio or video file.', 'info');
    logActivity('Started a new upload.');
    const fileInput = document.getElementById('media-file-input');
    if (fileInput) fileInput.click();
  });
}

async function discardSessionFiles() {
  await prepareForNewUpload({ silent: true });
  showToast('Your recording was deleted from the server.', 'success');
  logActivity('Session files discarded.');
}

async function prepareForNewUpload(opts = {}) {
  const sessionId = getSessionId();
  try {
    await fetch('/api/discard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ sessionId }),
      keepalive: true
    });
  } catch (e) {
    console.warn('Could not reach discard endpoint', e);
  }

  if (AppState.mediaObjectUrl) {
    URL.revokeObjectURL(AppState.mediaObjectUrl);
  }
  AppState.mediaFile = null;
  AppState.mediaBlobUrl = null;
  AppState.mediaObjectUrl = null;
  AppState.mediaIsVideo = false;
  AppState.currentBook = null;

  const mediaContainer = document.getElementById('media-player-container');
  if (mediaContainer) {
    mediaContainer.innerHTML = `
      <div class="media-empty">
        <p>No recording loaded yet</p>
        <small>Upload a file up to 1 GB. Any previous transcript is cleared first so the new recording can take its place.</small>
      </div>`;
  }
  const status = document.getElementById('media-status-label');
  if (status) status.textContent = 'No file yet';
  const progress = document.getElementById('upload-progress');
  if (progress) progress.hidden = true;
  const progressBar = document.getElementById('upload-progress-bar');
  if (progressBar) progressBar.style.width = '0%';

  if (typeof HighlightsModule !== 'undefined' && HighlightsModule.attachSourceMedia) {
    HighlightsModule.attachSourceMedia('', false);
  }

  resetWorkspace({ silent: true });
  setWorkspaceStatus('Ready for a new file');
  updateDashMeters();

  if (!opts.silent) {
    showToast('Previous transcript cleared. You can upload a new file.', 'info');
    logActivity('Previous transcript cleared.');
  }
}

function resetWorkspace(opts = {}) {
  AppState.currentTranscript = null;
  AppState.currentBook = null;
  AppState.activeChapterIndex = 0;
  AppState.readerCurrentPage = 0;

  const emptyCopy = 'Upload a recording, then transcribe. Any previous transcript is cleared first.';
  const feed = document.getElementById('transcript-feed');
  if (feed) feed.innerHTML = `<div class="empty-panel">${emptyCopy}</div>`;

  const count = document.getElementById('transcript-segment-count');
  if (count) count.textContent = '0';

  const search = document.getElementById('transcript-search');
  if (search) search.value = '';

  const globalSearch = document.getElementById('global-search');
  if (globalSearch) globalSearch.value = '';

  const fileInput = document.getElementById('media-file-input');
  if (fileInput) fileInput.value = '';

  const rawPane = document.getElementById('editor-raw-pane');
  const prosePane = document.getElementById('editor-prose-pane');
  const chapterList = document.getElementById('chapter-nav-list');
  if (rawPane) rawPane.innerHTML = '';
  if (prosePane) prosePane.innerHTML = '';
  if (chapterList) chapterList.innerHTML = '';

  if (typeof HighlightsModule !== 'undefined' && HighlightsModule.resetForNewUpload) {
    HighlightsModule.resetForNewUpload();
  }

  setWorkspaceStatus('Ready for a new file');
  updateDashMeters();

  if (!opts.silent) {
    showToast('Previous transcript cleared. You can upload a new file.', 'info');
    logActivity('Previous transcript cleared.');
  }
}

function setWorkspaceStatus(text) {
  const status = document.getElementById('workspace-status-label');
  if (status) status.textContent = text;
}

function updateDashMeters() {
  const lines = Number(String(document.getElementById('transcript-segment-count')?.textContent || '0').replace(/\D/g, '')) || 0;
  const hasFile = Boolean(AppState.mediaFile || AppState.mediaBlobUrl);
  const clips = (typeof HighlightsModule !== 'undefined' && HighlightsModule.clips) ? HighlightsModule.clips.length : 0;
  const setWidth = (id, pct) => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.max(6, Math.min(100, pct))}%`;
  };
  setWidth('stat-bar-lines', lines ? Math.min(100, 12 + lines * 2) : 6);
  setWidth('stat-bar-file', hasFile ? 100 : 6);
  setWidth('stat-bar-clips', clips ? Math.min(100, 18 + clips * 14) : 6);
  setWidth('stat-bar-workspace', hasFile ? (lines ? 100 : 55) : 12);
}

function logActivity(text) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  const item = document.createElement('li');
  const now = new Date();
  item.innerHTML = `<span>${text}</span><time>${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>`;
  feed.prepend(item);
  while (feed.children.length > 8) feed.lastElementChild.remove();
}

function initGlobalSearch() {
  const globalSearch = document.getElementById('global-search');
  const lineSearch = document.getElementById('transcript-search');
  if (!globalSearch) return;
  globalSearch.addEventListener('input', () => {
    if (lineSearch) {
      lineSearch.value = globalSearch.value;
      lineSearch.dispatchEvent(new Event('input'));
    }
  });
}

function initNavigation() {
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  AppState.activeTab = tabId;

  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-view').forEach((view) => {
    view.classList.toggle('active', view.id === `tab-${tabId}`);
  });

  const copy = TAB_COPY[tabId];
  if (copy) {
    const kicker = document.getElementById('topbar-kicker');
    const title = document.getElementById('topbar-title');
    if (kicker) kicker.textContent = copy.kicker;
    if (title) title.textContent = copy.title;
  }

  if (tabId === 'reader') {
    BookViewerModule.renderReader();
  } else if (tabId === 'editor') {
    TransformerModule.renderEditor();
  } else if (tabId === 'cover') {
    BookViewerModule.renderCoverStudio();
  } else if (tabId === 'highlights') {
    HighlightsModule.onTabEnter();
  }
}

function loadInitialShowcaseData() {
  // Kept for compatibility. The workspace now starts empty so a new upload is never blocked by leftover sample text.
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div>${message}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(16px)';
    setTimeout(() => toast.remove(), 280);
  }, 3600);
}

function formatClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const parts = [m, sec].map((n) => String(n).padStart(2, '0'));
  if (h > 0) return `${h}:${parts[0]}:${parts[1]}`;
  return `${parts[0]}:${parts[1]}`;
}
