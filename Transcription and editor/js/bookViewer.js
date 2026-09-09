/**
 * Book Viewer & Cover Studio Module
 * Interactive Book Spreads, Reader Themes, and Cover Customizer
 */

const BookViewerModule = {
  init() {
    this.bindThemeControls();
    this.bindPageControls();
    this.bindCoverInputs();
  },

  bindThemeControls() {
    const themeButtons = document.querySelectorAll('.theme-pill-btn');
    themeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        themeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const theme = btn.dataset.theme;
        AppState.readerTheme = theme;
        const spread = document.getElementById('interactive-book-spread');
        if (spread) {
          spread.className = `book-spread ${theme}`;
        }
      });
    });
  },

  bindPageControls() {
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (AppState.readerCurrentPage > 0) {
          AppState.readerCurrentPage--;
          this.renderReader();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const totalPages = AppState.currentBook?.chapters?.length || 1;
        if (AppState.readerCurrentPage < totalPages - 1) {
          AppState.readerCurrentPage++;
          this.renderReader();
        }
      });
    }
  },

  renderReader() {
    if (!AppState.currentBook || !AppState.currentBook.chapters) return;

    const chapters = AppState.currentBook.chapters;
    const currentChapter = chapters[AppState.readerCurrentPage] || chapters[0];
    const meta = AppState.currentBook.meta || {};

    const leftFolio = document.getElementById('reader-left-folio');
    const rightFolio = document.getElementById('reader-right-folio');
    const leftPageContent = document.getElementById('reader-left-content');
    const rightPageContent = document.getElementById('reader-right-content');
    const leftPageNum = document.getElementById('reader-left-page-num');
    const rightPageNum = document.getElementById('reader-right-page-num');

    if (leftFolio) leftFolio.textContent = meta.title || "The Gospel Appraisal";
    if (rightFolio) rightFolio.textContent = `${currentChapter.number}: ${currentChapter.title}`;

    const pNum = (AppState.readerCurrentPage * 2) + 1;
    if (leftPageNum) leftPageNum.textContent = pNum;
    if (rightPageNum) rightPageNum.textContent = pNum + 1;

    // Build Left Page: Chapter Title, Epigraph, Sub-section 1
    if (leftPageContent) {
      const sub1 = currentChapter.subsections?.[0];
      const paragraphs1 = sub1 ? sub1.content.split('\n\n') : [];

      leftPageContent.innerHTML = `
        <div class="book-chapter-title-hero">${currentChapter.number}</div>
        <h2 style="font-family: var(--font-display); font-size: 1.4rem; color: var(--accent-gold); margin-bottom: 0.5rem;">${currentChapter.title}</h2>
        <div class="book-chapter-subtitle-hero">${currentChapter.subtitle || ''}</div>
        ${currentChapter.epigraph ? `<div class="book-epigraph-quote">${currentChapter.epigraph}</div>` : ''}
        
        ${sub1 ? `
          ${sub1.heading ? `<h4 style="font-family: var(--font-display); font-size: 1rem; margin: 1.25rem 0 0.5rem 0; opacity: 0.9;">${sub1.heading}</h4>` : ''}
          <p class="drop-cap" style="margin-bottom: 1rem;">${paragraphs1[0] || ''}</p>
          ${paragraphs1.slice(1).map(p => `<p style="margin-bottom: 1rem; text-indent: 1.5rem;">${p}</p>`).join('')}
        ` : ''}
      `;
    }

    // Build Right Page: Sub-section 2, Pull Quote, Reflection Questions
    if (rightPageContent) {
      const sub2 = currentChapter.subsections?.[1];
      const paragraphs2 = sub2 ? sub2.content.split('\n\n') : [];

      rightPageContent.innerHTML = `
        ${sub2 ? `
          ${sub2.heading ? `<h4 style="font-family: var(--font-display); font-size: 1rem; margin-bottom: 0.5rem; opacity: 0.9;">${sub2.heading}</h4>` : ''}
          ${paragraphs2.map(p => `<p style="margin-bottom: 1rem; text-indent: 1.5rem;">${p}</p>`).join('')}
        ` : ''}

        ${currentChapter.pullQuote ? `
          <div style="font-style: italic; border-left: 2px solid var(--accent-gold); padding: 0.75rem 1rem; margin: 1.25rem 0; opacity: 0.9;">
            “${currentChapter.pullQuote}”
          </div>
        ` : ''}

        ${currentChapter.discussionQuestions?.length ? `
          <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px dashed rgba(0,0,0,0.2);">
            <h5 style="font-family: var(--font-display); font-size: 0.85rem; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 0.5rem;">Reflection & Questions</h5>
            <ol style="padding-left: 1.2rem; font-size: 0.9rem;">
              ${currentChapter.discussionQuestions.map(q => `<li style="margin-bottom: 0.4rem;">${q}</li>`).join('')}
            </ol>
          </div>
        ` : ''}
      `;
    }

    // Update page buttons state
    const prevBtn = document.getElementById('btn-prev-page');
    const nextBtn = document.getElementById('btn-next-page');
    if (prevBtn) prevBtn.disabled = AppState.readerCurrentPage === 0;
    if (nextBtn) nextBtn.disabled = AppState.readerCurrentPage >= chapters.length - 1;
  },

  renderCoverStudio() {
    if (!AppState.currentBook || !AppState.currentBook.meta) return;
    const meta = AppState.currentBook.meta;

    const coverTitle = document.getElementById('cover-preview-title');
    const coverSubtitle = document.getElementById('cover-preview-subtitle');
    const coverAuthor = document.getElementById('cover-preview-author');
    const coverGenre = document.getElementById('cover-preview-genre');

    if (coverTitle) coverTitle.textContent = meta.title || "The Spoken Wisdom";
    if (coverSubtitle) coverSubtitle.textContent = meta.subtitle || "A Prophetic and Historical Exegesis";
    if (coverAuthor) coverAuthor.textContent = meta.author || "Author Name";
    if (coverGenre) coverGenre.textContent = meta.genre || "Non-Fiction Edition";
  },

  bindCoverInputs() {
    const paletteSelect = document.getElementById('cover-palette-select');
    const coverMockup = document.getElementById('interactive-cover-3d');

    if (paletteSelect && coverMockup) {
      paletteSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'gold-obsidian') {
          coverMockup.style.background = 'linear-gradient(135deg, #090d16 0%, #1e1b4b 100%)';
          coverMockup.style.borderColor = 'rgba(212, 175, 55, 0.5)';
        } else if (val === 'crimson-royalty') {
          coverMockup.style.background = 'linear-gradient(135deg, #450a0a 0%, #18181b 100%)';
          coverMockup.style.borderColor = 'rgba(244, 63, 94, 0.5)';
        } else if (val === 'emerald-wisdom') {
          coverMockup.style.background = 'linear-gradient(135deg, #064e3b 0%, #0f172a 100%)';
          coverMockup.style.borderColor = 'rgba(16, 185, 129, 0.5)';
        } else if (val === 'sapphire-depth') {
          coverMockup.style.background = 'linear-gradient(135deg, #0c4a6e 0%, #030712 100%)';
          coverMockup.style.borderColor = 'rgba(14, 165, 233, 0.5)';
        }
      });
    }
  }
};
