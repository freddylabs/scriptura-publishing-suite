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
  mediaObjectUrl: null
};

const TAB_COPY = {
  studio: { kicker: 'Step 1 of 6', title: 'Upload & transcribe' },
  highlights: { kicker: 'Step 2 of 6', title: 'Select text, cut clips' },
  editor: { kicker: 'Step 3 of 6', title: 'Manuscript in your voice' },
  reader: { kicker: 'Step 4 of 6', title: 'Read the spread' },
  cover: { kicker: 'Step 5 of 6', title: 'Cover' },
  services: { kicker: 'Step 6 of 6', title: 'Publish' }
};

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  await loadInitialShowcaseData();
  TranscribeModule.init();
  HighlightsModule.init();
  TransformerModule.init();
  BookViewerModule.init();
  ExportModule.init();
});

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
