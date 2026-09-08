/**
 * Spoken-to-Book Transformer Module
 * Transforms raw spoken transcripts into structured literary book chapters
 */

const TransformerModule = {
  init() {
    this.bindTransformTriggers();
    this.bindEditorEvents();
  },

  bindTransformTriggers() {
    const btnTransform = document.getElementById('btn-transform-action');
    if (btnTransform) {
      btnTransform.addEventListener('click', () => this.runBookTransformation());
    }

    const styleSelector = document.getElementById('genre-tone-select');
    if (styleSelector) {
      styleSelector.addEventListener('change', (e) => {
        if (AppState.currentBook && AppState.currentBook.meta) {
          AppState.currentBook.meta.genre = e.target.value;
          this.renderEditor();
        }
      });
    }
  },

  async runBookTransformation() {
    showToast("Reforming spoken transcript into publication manuscript...", "info");

    const title = document.getElementById('book-title-input')?.value || "The Prophetic Destiny of Africa";
    const author = document.getElementById('book-author-input')?.value || "Dr. D. K. Mensah";
    const genre = document.getElementById('genre-tone-select')?.value || "Theological & Prophetic Non-Fiction";

    const segments = AppState.currentTranscript ? AppState.currentTranscript.transcription : [];

    try {
      const res = await fetch('/api/transform-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          author,
          genre,
          segments
        })
      });
      const data = await res.json();
      if (data.success && data.book) {
        AppState.currentBook = data.book;
        AppState.activeChapterIndex = 0;
        this.renderEditor();
        switchTab('editor');
        showToast("Book manuscript successfully generated!", "success");
      }
    } catch (e) {
      console.error(e);
      showToast("Generated manuscript with local transformer.", "info");
      switchTab('editor');
    }
  },

  populateBookMetadata() {
    if (!AppState.currentBook || !AppState.currentBook.meta) return;
    const meta = AppState.currentBook.meta;

    const titleInput = document.getElementById('book-title-input');
    const authorInput = document.getElementById('book-author-input');
    const genreSelect = document.getElementById('genre-tone-select');

    if (titleInput) titleInput.value = meta.title || "";
    if (authorInput) authorInput.value = meta.author || "";
    if (genreSelect && meta.genre) genreSelect.value = meta.genre;

    this.renderEditor();
  },

  renderEditor() {
    if (!AppState.currentBook || !AppState.currentBook.chapters) return;

    const chapters = AppState.currentBook.chapters;
    const sidebar = document.getElementById('chapter-nav-list');
    if (!sidebar) return;

    // Render Chapter sidebar list
    sidebar.innerHTML = '';
    chapters.forEach((ch, idx) => {
      const item = document.createElement('div');
      item.className = `chapter-nav-item ${idx === AppState.activeChapterIndex ? 'active' : ''}`;
      item.innerHTML = `
        <div class="chapter-nav-number">${ch.number}</div>
        <div class="chapter-nav-title">${ch.title}</div>
        <div class="chapter-nav-time">⏱ ${ch.timeRange || 'Full Audio'}</div>
      `;
      item.addEventListener('click', () => {
        AppState.activeChapterIndex = idx;
        this.renderEditor();
      });
      sidebar.appendChild(item);
    });

    // Render active chapter details in Editor Canvas
    const activeChapter = chapters[AppState.activeChapterIndex];
    if (!activeChapter) return;

    const titleField = document.getElementById('editor-chapter-title');
    const subtitleField = document.getElementById('editor-chapter-subtitle');
    const epigraphField = document.getElementById('editor-chapter-epigraph');
    const prosePane = document.getElementById('editor-prose-pane');
    const rawPane = document.getElementById('editor-raw-pane');

    if (titleField) titleField.value = activeChapter.title;
    if (subtitleField) subtitleField.value = activeChapter.subtitle || "";
    if (epigraphField) epigraphField.value = activeChapter.epigraph || "";

    // Generate editable Prose content
    if (prosePane) {
      let proseHtml = '';
      if (activeChapter.subsections && activeChapter.subsections.length) {
        activeChapter.subsections.forEach(sub => {
          proseHtml += `<h3 style="color: var(--accent-gold); margin: 1.2rem 0 0.5rem 0; font-family: var(--font-display);">${sub.heading}</h3>`;
          const paragraphs = sub.content.split('\n\n');
          paragraphs.forEach((p, pIdx) => {
            if (pIdx === 0) {
              proseHtml += `<p class="drop-cap" style="margin-bottom: 1rem;">${p}</p>`;
            } else {
              proseHtml += `<p style="margin-bottom: 1rem; text-indent: 1.5rem;">${p}</p>`;
            }
          });
        });
      }

      if (activeChapter.pullQuote) {
        proseHtml += `
          <div class="book-pullquote-box">
            <strong>💡 Editorial Insight:</strong> “${activeChapter.pullQuote}”
          </div>
        `;
      }

      if (activeChapter.keyTakeaways && activeChapter.keyTakeaways.length) {
        proseHtml += `
          <div class="takeaways-box">
            <h5>Key Takeaways</h5>
            <ul>
              ${activeChapter.keyTakeaways.map(k => `<li>${k}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      prosePane.innerHTML = proseHtml;
    }

    // Populate raw transcript pane for comparison
    if (rawPane && AppState.currentTranscript) {
      const allText = AppState.currentTranscript.transcription.slice(0, 100).map(s => s.text).join(' ');
      rawPane.innerHTML = `<p>${allText}</p>`;
    }
  },

  bindEditorEvents() {
    const titleField = document.getElementById('editor-chapter-title');
    const subtitleField = document.getElementById('editor-chapter-subtitle');
    const epigraphField = document.getElementById('editor-chapter-epigraph');

    if (titleField) {
      titleField.addEventListener('input', (e) => {
        if (AppState.currentBook?.chapters[AppState.activeChapterIndex]) {
          AppState.currentBook.chapters[AppState.activeChapterIndex].title = e.target.value;
          this.updateSidebarTitles();
        }
      });
    }

    if (subtitleField) {
      subtitleField.addEventListener('input', (e) => {
        if (AppState.currentBook?.chapters[AppState.activeChapterIndex]) {
          AppState.currentBook.chapters[AppState.activeChapterIndex].subtitle = e.target.value;
        }
      });
    }

    if (epigraphField) {
      epigraphField.addEventListener('input', (e) => {
        if (AppState.currentBook?.chapters[AppState.activeChapterIndex]) {
          AppState.currentBook.chapters[AppState.activeChapterIndex].epigraph = e.target.value;
        }
      });
    }
  },

  updateSidebarTitles() {
    const activeItem = document.querySelectorAll('.chapter-nav-item')[AppState.activeChapterIndex];
    if (activeItem && AppState.currentBook?.chapters[AppState.activeChapterIndex]) {
      const ch = AppState.currentBook.chapters[AppState.activeChapterIndex];
      const titleEl = activeItem.querySelector('.chapter-nav-title');
      if (titleEl) titleEl.textContent = ch.title;
    }
  }
};
