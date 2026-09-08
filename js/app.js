/**
 * Scriptura: Video-to-Book Main Application Controller
 */

const AppState = {
  activeTab: 'studio',
  currentTranscript: null,
  currentBook: null,
  activeChapterIndex: 0,
  readerCurrentPage: 0,
  readerTheme: 'theme-dark',
  mediaFile: null
};

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initQuickGuide();
  await loadInitialShowcaseData();
  TranscribeModule.init();
  HighlightsModule.init();
  TransformerModule.init();
  BookViewerModule.init();
  ExportModule.init();
});

function initQuickGuide() {
  const guideSteps = document.querySelectorAll('.guide-step-card');
  guideSteps.forEach(card => {
    card.addEventListener('click', () => {
      const tab = card.dataset.targetTab;
      if (tab) switchTab(tab);
    });
  });
}

function initNavigation() {
  const tabButtons = document.querySelectorAll('.nav-tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  AppState.activeTab = tabId;

  // Update navigation buttons
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update tab views
  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === `tab-${tabId}`);
  });

  // Re-render specific tab contents when active
  if (tabId === 'reader') {
    BookViewerModule.renderReader();
  } else if (tabId === 'editor') {
    TransformerModule.renderEditor();
  } else if (tabId === 'cover') {
    BookViewerModule.renderCoverStudio();
  }
}

async function loadInitialShowcaseData() {
  try {
    // 1. Fetch preloaded transcript
    const transRes = await fetch('/api/sample-transcript');
    if (transRes.ok) {
      AppState.currentTranscript = await transRes.json();
      TranscribeModule.renderTranscriptList(AppState.currentTranscript.transcription);
    }

    // 2. Fetch preloaded book
    const bookRes = await fetch('/api/sample-book');
    if (bookRes.ok) {
      AppState.currentBook = await bookRes.json();
      TransformerModule.populateBookMetadata();
    }
  } catch (err) {
    console.warn("Could not fetch sample data from server, using local fallback:", err);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>✨</span> <div>${message}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
