/**
 * Spoken-to-book shaping and light grammar proofreading.
 * Keeps the speaker's voice. Does not invent academic filler.
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

    const btnProof = document.getElementById('btn-proofread-chapter');
    if (btnProof) {
      btnProof.addEventListener('click', () => this.proofreadActiveChapter());
    }

    const styleSelector = document.getElementById('genre-tone-select');
    if (styleSelector) {
      styleSelector.addEventListener('change', (e) => {
        if (AppState.currentBook?.meta) {
          AppState.currentBook.meta.genre = e.target.value;
        }
      });
    }
  },

  async runBookTransformation() {
    showToast('Shaping the talk into chapters, keeping the spoken voice…', 'info');

    const title = document.getElementById('book-title-input')?.value || 'Untitled manuscript';
    const author = document.getElementById('book-author-input')?.value || 'Author';
    const genre = document.getElementById('genre-tone-select')?.value || 'Theological & Prophetic Non-Fiction';
    const segments = AppState.currentTranscript ? AppState.currentTranscript.transcription : [];

    try {
      const res = await fetch('/api/transform-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, author, genre, segments })
      });
      const data = await res.json();
      if (data.success && data.book) {
        AppState.currentBook = data.book;
        AppState.activeChapterIndex = 0;
        this.renderEditor();
        switchTab('editor');
        showToast('Draft chapters are ready. Proofread a chapter if a line still sounds like raw speech.', 'success');
        return;
      }
    } catch (e) {
      console.warn(e);
    }

    AppState.currentBook = this.localShapeBook(title, author, genre, segments);
    AppState.activeChapterIndex = 0;
    this.renderEditor();
    switchTab('editor');
    showToast('Drafted chapters locally, with light cleanup only.', 'info');
  },

  localShapeBook(title, author, genre, segments) {
    const chapters = this.shapeChapters(segments || []);
    return {
      meta: {
        title,
        subtitle: 'Shaped from a spoken recording',
        author,
        genre,
        edition: 'Working draft',
        publicationDate: '2026',
        summary: 'A readable draft taken from spoken language, with fillers removed and sentences repaired.'
      },
      chapters
    };
  },

  shapeChapters(segments) {
    if (!segments.length) return AppState.currentBook?.chapters || [];

    const chunks = this.partitionSegments(segments);
    const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

    return chunks.map((chunk, idx) => {
      const startTs = chunk[0].timestamps?.from || '00:00:00';
      const endTs = chunk[chunk.length - 1].timestamps?.to || '00:00:00';
      const raw = chunk.map((s) => (s.text || '').trim()).join(' ');
      const cleaned = proofreadProse(raw);
      const paragraphs = groupSentences(cleaned);
      const title = pickSpokenTitle(cleaned) || `Chapter ${names[idx] || idx + 1}`;
      const quote = pickSpokenQuote(cleaned);

      const mid = Math.ceil(paragraphs.length / 2) || 1;
      const first = paragraphs.slice(0, mid).join('\n\n');
      const second = paragraphs.slice(mid).join('\n\n');

      const subsections = [{ heading: '', content: first }];
      if (second) subsections.push({ heading: '', content: second });

      return {
        id: idx + 1,
        number: `Chapter ${names[idx] || idx + 1}`,
        title,
        subtitle: `${TranscribeModule.shortClock(startTs)} – ${TranscribeModule.shortClock(endTs)}`,
        epigraph: '',
        timeRange: `${startTs} – ${endTs}`,
        summary: '',
        subsections,
        pullQuote: quote,
        keyTakeaways: pickSpokenTakeaways(cleaned),
        discussionQuestions: []
      };
    });
  },

  partitionSegments(segments) {
    const total = segments.length;
    const groups = Math.min(5, Math.max(3, Math.round(total / 160)));
    const size = Math.ceil(total / groups);
    const chunks = [];
    for (let i = 0; i < total; i += size) {
      chunks.push(segments.slice(i, i + size));
    }
    return chunks.slice(0, 6);
  },

  populateBookMetadata() {
    if (!AppState.currentBook?.meta) return;
    const meta = AppState.currentBook.meta;
    const titleInput = document.getElementById('book-title-input');
    const authorInput = document.getElementById('book-author-input');
    const genreSelect = document.getElementById('genre-tone-select');
    if (titleInput) titleInput.value = meta.title || '';
    if (authorInput) authorInput.value = meta.author || '';
    if (genreSelect && meta.genre) genreSelect.value = meta.genre;
    this.renderEditor();
  },

  renderEditor() {
    if (!AppState.currentBook?.chapters) return;
    const chapters = AppState.currentBook.chapters;
    const sidebar = document.getElementById('chapter-nav-list');
    const countBadge = document.getElementById('chapter-count-badge');
    if (countBadge) countBadge.textContent = `${chapters.length}`;
    if (!sidebar) return;

    sidebar.innerHTML = '';
    chapters.forEach((ch, idx) => {
      const item = document.createElement('div');
      item.className = `chapter-nav-item ${idx === AppState.activeChapterIndex ? 'active' : ''}`;
      item.innerHTML = `
        <div class="chapter-nav-number">${ch.number}</div>
        <div class="chapter-nav-title">${ch.title}</div>
        <div class="chapter-nav-time">${ch.subtitle || ch.timeRange || ''}</div>
      `;
      item.addEventListener('click', () => {
        AppState.activeChapterIndex = idx;
        this.renderEditor();
      });
      sidebar.appendChild(item);
    });

    const activeChapter = chapters[AppState.activeChapterIndex];
    if (!activeChapter) return;

    const titleField = document.getElementById('editor-chapter-title');
    const subtitleField = document.getElementById('editor-chapter-subtitle');
    const epigraphField = document.getElementById('editor-chapter-epigraph');
    const prosePane = document.getElementById('editor-prose-pane');
    const rawPane = document.getElementById('editor-raw-pane');

    if (titleField) titleField.value = activeChapter.title;
    if (subtitleField) subtitleField.value = activeChapter.subtitle || '';
    if (epigraphField) epigraphField.value = activeChapter.epigraph || '';

    if (prosePane) {
      let proseHtml = '';
      (activeChapter.subsections || []).forEach((sub) => {
        if (sub.heading) {
          proseHtml += `<h3 class="prose-heading">${sub.heading}</h3>`;
        }
        String(sub.content || '').split('\n\n').forEach((p, pIdx) => {
          const cls = pIdx === 0 && !sub.heading ? 'drop-cap' : '';
          proseHtml += `<p class="${cls}" style="margin-bottom: 1rem;">${p}</p>`;
        });
      });
      if (activeChapter.pullQuote) {
        proseHtml += `<div class="book-pullquote-box">“${activeChapter.pullQuote}”</div>`;
      }
      if (activeChapter.keyTakeaways?.length) {
        proseHtml += `
          <div class="takeaways-box">
            <h5>From this stretch of the talk</h5>
            <ul>${activeChapter.keyTakeaways.map((k) => `<li>${k}</li>`).join('')}</ul>
          </div>`;
      }
      prosePane.innerHTML = proseHtml;
    }

    if (rawPane && AppState.currentTranscript?.transcription) {
      const slice = this.rawSliceForChapter(activeChapter);
      rawPane.innerHTML = `<p>${TranscribeModule.escapeHtml(slice)}</p>`;
    }
  },

  rawSliceForChapter(chapter) {
    const all = AppState.currentTranscript.transcription.map((s) => s.text).join(' ');
    return all.slice(0, 1800);
  },

  bindEditorEvents() {
    const titleField = document.getElementById('editor-chapter-title');
    const subtitleField = document.getElementById('editor-chapter-subtitle');
    const epigraphField = document.getElementById('editor-chapter-epigraph');
    const prosePane = document.getElementById('editor-prose-pane');

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
    if (prosePane) {
      prosePane.addEventListener('blur', () => this.persistProseFromEditor());
    }
  },

  persistProseFromEditor() {
    const chapter = AppState.currentBook?.chapters[AppState.activeChapterIndex];
    const prosePane = document.getElementById('editor-prose-pane');
    if (!chapter || !prosePane) return;
    const paragraphs = [...prosePane.querySelectorAll('p')].map((p) => p.innerText.trim()).filter(Boolean);
    if (!paragraphs.length) return;
    const mid = Math.ceil(paragraphs.length / 2);
    chapter.subsections = [
      { heading: chapter.subsections?.[0]?.heading || '', content: paragraphs.slice(0, mid).join('\n\n') }
    ];
    if (paragraphs.length > mid) {
      chapter.subsections.push({
        heading: chapter.subsections?.[1]?.heading || '',
        content: paragraphs.slice(mid).join('\n\n')
      });
    }
  },

  async proofreadActiveChapter() {
    const chapter = AppState.currentBook?.chapters[AppState.activeChapterIndex];
    if (!chapter) {
      showToast('Shape a manuscript first.', 'warning');
      return;
    }

    this.persistProseFromEditor();
    showToast('Proofreading grammar only — not rewriting the argument…', 'info');

    const joined = (chapter.subsections || []).map((s) => s.content).join('\n\n');
    let cleaned = proofreadProse(joined);

    try {
      const res = await fetch('/api/proofread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: joined })
      });
      const data = await res.json();
      if (data.success && data.text) cleaned = data.text;
    } catch (e) {
      // local proofread is enough
    }

    const paragraphs = groupSentences(cleaned);
    const mid = Math.ceil(paragraphs.length / 2) || 1;
    chapter.subsections = [
      { heading: chapter.subsections?.[0]?.heading || '', content: paragraphs.slice(0, mid).join('\n\n') }
    ];
    if (paragraphs.length > mid) {
      chapter.subsections.push({
        heading: chapter.subsections?.[1]?.heading || '',
        content: paragraphs.slice(mid).join('\n\n')
      });
    }
    this.renderEditor();
    showToast('Grammar and fillers cleaned. The wording still follows the speaker.', 'success');
  },

  updateSidebarTitles() {
    const activeItem = document.querySelectorAll('.chapter-nav-item')[AppState.activeChapterIndex];
    if (activeItem && AppState.currentBook?.chapters[AppState.activeChapterIndex]) {
      const titleEl = activeItem.querySelector('.chapter-nav-title');
      if (titleEl) titleEl.textContent = AppState.currentBook.chapters[AppState.activeChapterIndex].title;
    }
  }
};

function proofreadProse(raw) {
  let t = String(raw || '');
  t = t.replace(/\[.*?\]/g, '');
  t = t.replace(/\((applause|laughter|music|inaudible|pause)\)/gi, '');
  t = t.replace(/\b(um+|uh+|er+|ah+|hmm+|you know|i mean|kind of|sort of)\b/gi, '');
  t = t.replace(/\bgonna\b/gi, 'going to');
  t = t.replace(/\bwanna\b/gi, 'want to');
  t = t.replace(/\bgotta\b/gi, 'have to');
  t = t.replace(/\blets\b/gi, "let's");
  t = t.replace(/\bafrica\b/gi, 'Africa');
  t = t.replace(/\bgod\b/g, 'God');
  t = t.replace(/\b(\w+)\s+\1\b/gi, '$1');
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.replace(/,([.!?])/g, '$1');
  t = t.replace(/([.!?]){2,}/g, '$1');
  t = t.replace(/([.!?])([A-Za-z])/g, '$1 $2');
  t = t.replace(/\s+/g, ' ').trim();

  const parts = t.split(/([.!?]+)/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    let sentence = (parts[i] || '').trim();
    const punct = parts[i + 1] || '';
    if (!sentence) continue;
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    out.push(sentence + punct);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function groupSentences(text) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const paras = [];
  let bucket = [];
  sentences.forEach((s) => {
    bucket.push(s.trim());
    if (bucket.length >= 3) {
      paras.push(bucket.join(' '));
      bucket = [];
    }
  });
  if (bucket.length) paras.push(bucket.join(' '));
  return paras.filter(Boolean);
}

function pickSpokenTitle(text) {
  const sentences = (text.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim());
  const skip = /^(and|so|but|now|well|okay|yes|because|then)\b/i;
  for (const s of sentences.slice(0, 10)) {
    const words = s.replace(/["“”]/g, '').replace(/[.!?]+$/, '').split(/\s+/);
    if (words.length >= 5 && words.length <= 12 && !skip.test(s)) {
      return words.slice(0, 8).join(' ').replace(/[ ,;:]+$/, '');
    }
  }
  return '';
}

function pickSpokenQuote(text) {
  const sentences = (text.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim());
  const hit = sentences.find((s) => s.length > 40 && s.length < 180 && /never|not|god|africa|you are|truth|word/i.test(s));
  return hit ? hit.replace(/^["“]|["”]$/g, '') : '';
}

function pickSpokenTakeaways(text) {
  const sentences = (text.match(/[^.!?]+[.!?]+/g) || []).map((s) => s.trim());
  return sentences
    .filter((s) => s.length > 28 && s.length < 140)
    .slice(0, 3);
}
