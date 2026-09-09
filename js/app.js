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
  studio: { kicker: 'Step 1 of 6', title: 'Upload & transcribe' },
  highlights: { kicker: 'Step 2 of 6', title: 'Select text, cut clips' },
  editor: { kicker: 'Step 3 of 6', title: 'Manuscript in your voice' },
  reader: { kicker: 'Step 4 of 6', title: 'Read the spread' },
  cover: { kicker: 'Step 5 of 6', title: 'Cover' },
  services: { kicker: 'Step 6 of 6', title: 'Publish' }
};

document.addEventListener('DOMContentLoaded', async () => {
  getSessionId();
  initNavigation();
  initFinishButton();
  await loadInitialShowcaseData();
  TranscribeModule.init();
  HighlightsModule.init();
  TransformerModule.init();
  BookViewerModule.init();
  ExportModule.init();
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
    await discardSessionFiles();
  });
}

async function discardSessionFiles() {
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

  if (typeof HighlightsModule !== 'undefined') {
    HighlightsModule.clips.forEach((clip) => {
      if (clip.revokeOnClear && clip.url) URL.revokeObjectURL(clip.url);
    });
    HighlightsModule.clips = [];
    HighlightsModule.renderLibrary();
    HighlightsModule.attachSourceMedia('', false);
  }

  const mediaContainer = document.getElementById('media-player-container');
  if (mediaContainer) {
    mediaContainer.innerHTML = `
      <div class="media-empty">
        <p>No recording loaded yet</p>
        <small>Upload a file up to 1 GB. It will be deleted when you finish, or after 4 hours.</small>
      </div>`;
  }
  const status = document.getElementById('media-status-label');
  if (status) status.textContent = 'No file yet';
  const progress = document.getElementById('upload-progress');
  if (progress) progress.hidden = true;

  showToast('Your recording was deleted from the server.', 'success');
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

async function loadInitialShowcaseData() {
  try {
    const transRes = await fetch('/api/sample-transcript');
    if (transRes.ok) {
      AppState.currentTranscript = await transRes.json();
      TranscribeModule.renderTranscriptList(AppState.currentTranscript.transcription);
    }

    const bookRes = await fetch('/api/sample-book');
    if (bookRes.ok) {
      AppState.currentBook = await bookRes.json();
      TransformerModule.populateBookMetadata();
    }
  } catch (err) {
    console.warn('Could not fetch sample data from the server:', err);
  }
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
