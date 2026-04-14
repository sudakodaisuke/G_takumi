/* ============================================================
   G検定 問題演習アプリ - app.js
   ============================================================ */

'use strict';

// ---- グローバル状態 ----
const App = {
  data: null,
  session: null,
  timerInterval: null,
};

// ---- LocalStorage キー ----
const STORAGE_KEY    = 'g_quiz_history';
const SESSION_KEY    = 'g_quiz_session';   // 途中保存
const THEME_KEY      = 'g_quiz_theme';     // テーマ設定

// ---- テーマ設定 ----
const THEMES = ['light', 'dark', 'merhen'];
const THEME_ICONS = { light: '☀️', dark: '🌙', merhen: '🌸' };

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = THEME_ICONS[theme] || '☀️';
  localStorage.setItem(THEME_KEY, theme);
}

function cycleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
  const names = { light: 'ライトモード', dark: 'ダークモード', merhen: 'メルヘンモード' };
  showToast(names[next] + ' にしました');
}

// ---- トースト通知 ----
function showToast(msg, duration = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ---- クイズ中のPull-to-Refresh防止 ----
function enableQuizMode() {
  document.body.classList.add('quiz-active');
}
function disableQuizMode() {
  document.body.classList.remove('quiz-active');
}

// ---- セッション途中保存 ----
function saveSessionProgress() {
  const sess = App.session;
  if (!sess) return;
  try {
    const data = {
      mode: sess.mode,
      questionIds: sess.questions.map(q => q.id),
      current: sess.current,
      answers: sess.answers.map(a => ({
        qId: a.question.id,
        sel: a.selected,
        ok: a.correct
      })),
      chapters: sess.selectedChapters,
      startTime: sess.startTime,
      remaining: sess.remaining ?? null,
      savedAt: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch(e) {
    console.warn('セッション保存エラー:', e);
  }
}

function clearSessionProgress() {
  localStorage.removeItem(SESSION_KEY);
}

function loadSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function restoreSession(saved) {
  const allQ = App.data.chapters.flatMap(c => c.questions);
  const qMap = {};
  allQ.forEach(q => qMap[q.id] = q);

  const questions = saved.questionIds.map(id => qMap[id]).filter(Boolean);
  if (questions.length === 0) return false;

  const answers = (saved.answers || []).map(a => ({
    question: qMap[a.qId],
    selected: a.sel,
    correct: a.ok
  })).filter(a => a.question);

  App.session = {
    mode: saved.mode,
    questions,
    current: Math.min(saved.current, questions.length),
    answers,
    selectedChapters: saved.chapters || [],
    startTime: saved.startTime || Date.now(),
    remaining: saved.remaining ?? null,
    timeLimit: saved.mode === 'exam' ? 120 * 60 : null
  };
  return true;
}

// ---- 起動 ----
window.addEventListener('DOMContentLoaded', () => {
  initTheme();

  fetch('questions.json')
    .then(r => r.json())
    .then(data => {
      App.data = data;
      showHome();
    })
    .catch(err => {
      document.getElementById('loading').innerHTML =
        '<div class="loading-box"><p>問題データの読み込みに失敗しました。<br>ページを更新してください。</p></div>';
      console.error(err);
    });
});

// ページ離脱時にセッションを自動保存
window.addEventListener('beforeunload', () => {
  if (App.session) saveSessionProgress();
});

/* ============================================================
   画面レンダリング
   ============================================================ */

function render(html) {
  document.getElementById('app').innerHTML = html;
}

/* ---- ホーム画面 ---- */
function showHome() {
  disableQuizMode();
  const history = loadHistory();
  const totalSessions = history.sessions.length;
  const examSessions = history.sessions.filter(s => s.mode === 'exam').length;

  let totalQ = 0, totalC = 0;
  Object.values(history.chapter_stats).forEach(s => { totalQ += s.total; totalC += s.correct; });
  const overallPct = totalQ > 0 ? Math.round(totalC / totalQ * 100) : null;

  // 途中保存チェック
  const saved = loadSavedSession();
  let resumeHtml = '';
  if (saved) {
    const savedDate = new Date(saved.savedAt);
    const dateStr = `${savedDate.getMonth()+1}/${savedDate.getDate()} ${savedDate.getHours()}:${String(savedDate.getMinutes()).padStart(2,'0')}`;
    const modeLabel = saved.mode === 'exam' ? '模試' : '学習';
    const progress = `${saved.current}/${saved.questionIds.length}問`;
    const timeLeft = saved.remaining != null ? `（残り${Math.floor(saved.remaining/60)}分）` : '';
    resumeHtml = `
      <div class="resume-card fade-in">
        <div class="resume-card-title">📌 前回の${modeLabel}モードが保存されています</div>
        <div class="resume-card-info">${dateStr}保存 ・ ${progress}回答済み${timeLeft}</div>
        <div class="resume-actions">
          <button class="btn-resume" onclick="resumeSession()">続きから再開</button>
          <button class="btn-discard" onclick="discardSession()">破棄する</button>
        </div>
      </div>`;
  }

  render(`
    <div class="screen active">
      <div class="home-hero">
        <h1>G検定 問題演習</h1>
        <p>JDLA Deep Learning for GENERAL 対策アプリ</p>
      </div>
      <div class="home-content">
        ${resumeHtml}
        ${overallPct !== null ? `
        <div class="info-card" style="display:flex;align-items:center;gap:16px;">
          <div style="font-size:2.2rem;font-weight:700;color:var(--primary)">${overallPct}%</div>
          <div>
            <div style="font-size:0.9rem;font-weight:600;color:var(--text)">累計正答率</div>
            <div style="font-size:0.8rem;color:var(--text-secondary)">${totalQ}問 / ${totalC}問正解</div>
          </div>
        </div>` : ''}
        <div class="mode-grid">
          <div class="mode-card" onclick="showStudySetup()">
            <div class="mode-icon">📖</div>
            <div class="mode-name">学習モード</div>
            <div class="mode-desc">分野・問題数を選んで<br>解答後すぐ解説表示</div>
          </div>
          <div class="mode-card" onclick="showExamSetup()">
            <div class="mode-icon">📝</div>
            <div class="mode-name">模試モード</div>
            <div class="mode-desc">150問 / 120分<br>全分野ランダム出題</div>
          </div>
          <div class="mode-card stats-card" onclick="showStats()">
            <div class="mode-icon">📊</div>
            <div class="mode-name">成績確認</div>
            <div class="mode-desc">分野別正答率・過去の演習履歴を確認 (${totalSessions}回 / 模試${examSessions}回)</div>
          </div>
        </div>
        <div class="info-card">
          <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.6;">
            <strong>問題数</strong>: 第1〜10章 ${chapters1to10().reduce((a,c)=>a+c.questions.length,0)}問、第11章（総仕上げ）${App.data.chapters[10].questions.length}問
          </div>
        </div>
      </div>
    </div>
  `);
}

function resumeSession() {
  const saved = loadSavedSession();
  if (!saved || !restoreSession(saved)) {
    clearSessionProgress();
    showToast('セッションを復元できませんでした');
    showHome();
    return;
  }
  enableQuizMode();
  if (App.session.mode === 'exam' && App.session.remaining == null) {
    App.session.remaining = 120 * 60;
  }
  showQuestion();
  showToast('続きから再開しました');
}

function discardSession() {
  clearSessionProgress();
  App.session = null;
  showHome();
  showToast('保存データを削除しました');
}

/* ---- 学習モード設定 ---- */
function showStudySetup() {
  const chapters = App.data.chapters;

  render(`
    <div class="screen active">
      <div class="app-header">
        <button class="btn-back" onclick="showHome()">←</button>
        <h1>学習モード設定</h1>
      </div>
      <div class="container">
        <div class="setup-section">
          <h3>分野を選択</h3>
          <div class="field-grid">
            <div class="field-chip field-all-btn selected" onclick="selectAllChapters()" id="chip-all">
              全分野（第1〜10章）
            </div>
            ${chapters.slice(0,10).map(ch =>
              `<div class="field-chip" onclick="toggleChapter(${ch.id})" id="chip-${ch.id}">
                第${ch.id}章<br><small>${ch.name}</small>
              </div>`
            ).join('')}
            <div class="field-chip" onclick="toggleChapter(11)" id="chip-11" style="grid-column:1/-1;">
              第11章（総仕上げ問題）
            </div>
          </div>
        </div>
        <div class="setup-section">
          <h3>問題数</h3>
          <div class="count-buttons">
            <button class="count-btn selected" onclick="selectCount(10)" id="cnt-10">10問</button>
            <button class="count-btn" onclick="selectCount(30)" id="cnt-30">30問</button>
            <button class="count-btn" onclick="selectCount(50)" id="cnt-50">50問</button>
          </div>
        </div>
        <div class="setup-section">
          <h3>出題順</h3>
          <div class="radio-group">
            <label class="radio-option selected" id="ord-seq">
              <input type="radio" name="order" value="seq" checked onchange="selectOrder('seq')">
              <span>順番に出題</span>
            </label>
            <label class="radio-option" id="ord-rand">
              <input type="radio" name="order" value="rand" onchange="selectOrder('rand')">
              <span>ランダム出題</span>
            </label>
          </div>
        </div>
        <button class="btn-primary" onclick="startStudy()">学習を開始する</button>
      </div>
    </div>
  `);

  window._studySetup = {
    selectedChapters: [1,2,3,4,5,6,7,8,9,10],
    count: 10,
    order: 'seq',
    allSelected: true
  };
}

function toggleChapter(id) {
  const s = window._studySetup;
  const chipAll = document.getElementById('chip-all');

  if (id === 11) {
    if (s.selectedChapters.includes(11)) {
      s.selectedChapters = s.selectedChapters.filter(c => c !== 11);
    } else {
      s.selectedChapters = [11];
      s.allSelected = false;
      chipAll.classList.remove('selected');
    }
  } else {
    if (s.allSelected) {
      s.selectedChapters = [];
      s.allSelected = false;
      chipAll.classList.remove('selected');
    }
    if (s.selectedChapters.includes(id)) {
      s.selectedChapters = s.selectedChapters.filter(c => c !== id);
    } else {
      s.selectedChapters.push(id);
    }
  }

  for (let i = 1; i <= 11; i++) {
    const el = document.getElementById(`chip-${i}`);
    if (el) el.classList.toggle('selected', s.selectedChapters.includes(i));
  }
  if (chipAll) chipAll.classList.toggle('selected', s.allSelected);
}

function selectAllChapters() {
  const s = window._studySetup;
  s.selectedChapters = [1,2,3,4,5,6,7,8,9,10];
  s.allSelected = true;
  for (let i = 1; i <= 11; i++) {
    const el = document.getElementById(`chip-${i}`);
    if (el) el.classList.toggle('selected', i >= 1 && i <= 10);
  }
  document.getElementById('chip-all')?.classList.add('selected');
}

function selectCount(n) {
  window._studySetup.count = n;
  [10, 30, 50].forEach(c => {
    document.getElementById(`cnt-${c}`)?.classList.toggle('selected', c === n);
  });
}

function selectOrder(val) {
  window._studySetup.order = val;
  document.getElementById('ord-seq').classList.toggle('selected', val === 'seq');
  document.getElementById('ord-rand').classList.toggle('selected', val === 'rand');
}

function startStudy() {
  const s = window._studySetup;
  if (!s.selectedChapters.length) { alert('分野を1つ以上選択してください'); return; }

  let pool = [];
  s.selectedChapters.forEach(cid => {
    const ch = App.data.chapters.find(c => c.id === cid);
    if (ch) pool.push(...ch.questions);
  });
  if (!pool.length) { alert('選択した分野に問題がありません'); return; }

  if (s.order === 'rand') pool = shuffle(pool);
  const questions = pool.slice(0, s.count);

  App.session = {
    mode: 'study',
    questions,
    current: 0,
    answers: [],
    selectedChapters: s.selectedChapters,
    startTime: Date.now(),
    remaining: null
  };
  clearSessionProgress();
  enableQuizMode();
  showQuestion();
}

/* ---- 模試設定・確認画面 ---- */
function showExamSetup() {
  const pool = chapters1to10().flatMap(c => c.questions);

  render(`
    <div class="screen active">
      <div class="app-header">
        <button class="btn-back" onclick="showHome()">←</button>
        <h1>模試モード</h1>
      </div>
      <div class="container">
        <div class="exam-info-card">
          <h2>模試について</h2>
          <div class="info-row"><span class="info-label">出題数</span><span class="info-value">150問</span></div>
          <div class="info-row"><span class="info-label">制限時間</span><span class="info-value">120分</span></div>
          <div class="info-row"><span class="info-label">出題範囲</span><span class="info-value">第1〜10章（全分野）</span></div>
          <div class="info-row"><span class="info-label">出題順</span><span class="info-value">ランダム</span></div>
          <div class="info-row"><span class="info-label">解答確認</span><span class="info-value">終了後まとめて表示</span></div>
          <div class="info-row"><span class="info-label">利用可能問題数</span><span class="info-value">${pool.length}問</span></div>
        </div>
        <div class="exam-warning">
          模試中は解答後すぐに正解・解説は表示されません。<br>
          中断した場合も進捗は自動保存され、ホームから再開できます。
        </div>
        <button class="btn-primary" onclick="startExam()">模試を開始する</button>
        <button class="btn-secondary" onclick="showHome()">キャンセル</button>
      </div>
    </div>
  `);
}

function startExam() {
  const pool = shuffle(chapters1to10().flatMap(c => c.questions));
  const questions = pool.slice(0, 150);

  App.session = {
    mode: 'exam',
    questions,
    current: 0,
    answers: [],
    selectedChapters: [1,2,3,4,5,6,7,8,9,10],
    startTime: Date.now(),
    timeLimit: 120 * 60,
    remaining: 120 * 60
  };
  clearSessionProgress();
  enableQuizMode();
  showQuestion();
}

/* ---- 問題表示 ---- */
function showQuestion() {
  const sess = App.session;
  const q = sess.questions[sess.current];
  const total = sess.questions.length;
  const num = sess.current + 1;
  const pct = Math.round((sess.current / total) * 100);
  const ch = App.data.chapters.find(c => c.id === q.chapter_id);

  const choicesHtml = Object.entries(q.choices).map(([letter, text]) =>
    `<button class="choice-btn fade-in" onclick="answerQuestion('${letter}')" id="choice-${letter}">
      <span class="choice-letter">${letter}</span>
      <span class="choice-text">${escHtml(text)}</span>
    </button>`
  ).join('');

  const timerHtml = sess.mode === 'exam'
    ? `<span class="timer" id="timer">${formatTime(sess.remaining)}</span>`
    : `<span style="font-size:0.9rem;opacity:0.85">${num} / ${total}</span>`;

  render(`
    <div class="screen active">
      <div class="quiz-header">
        <div class="quiz-header-top">
          <span class="quiz-chapter">${ch ? `第${ch.id}章 ${ch.name}` : ''}</span>
          ${timerHtml}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span class="quiz-progress-text">${num} / ${total}</span>
          <button style="background:rgba(255,255,255,0.15);border:none;color:var(--header-text);padding:4px 10px;border-radius:20px;cursor:pointer;font-size:0.8rem;" onclick="confirmQuit()">中断・保存</button>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="quiz-body">
        <div class="question-card fade-in">
          <div class="question-num">問${num}</div>
          <div class="question-text">${escHtml(q.text)}</div>
        </div>
        <div class="choices-list" id="choices">
          ${choicesHtml}
        </div>
        <div id="explanation-area"></div>
      </div>
    </div>
  `);

  if (sess.mode === 'exam') startTimer();
}

function startTimer() {
  if (App.timerInterval) clearInterval(App.timerInterval);
  App.timerInterval = setInterval(() => {
    const sess = App.session;
    if (!sess) { clearInterval(App.timerInterval); return; }
    sess.remaining--;

    const el = document.getElementById('timer');
    if (el) {
      el.textContent = formatTime(sess.remaining);
      if (sess.remaining <= 60) el.className = 'timer danger';
      else if (sess.remaining <= 600) el.className = 'timer warning';
    }

    if (sess.remaining <= 0) {
      clearInterval(App.timerInterval);
      finishSession();
    }
  }, 1000);
}

function formatTime(secs) {
  const s = Math.max(0, secs);
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
}

/* ---- 解答処理 ---- */
function answerQuestion(letter) {
  const sess = App.session;
  const q = sess.questions[sess.current];
  const correct = q.answer;
  const isCorrect = letter === correct;

  sess.answers.push({ question: q, selected: letter, correct: isCorrect });

  // 自動保存（学習・模試ともに）
  saveSessionProgress();

  // ボタン色付け
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    const l = btn.querySelector('.choice-letter').textContent;
    if (l === correct) btn.classList.add('correct-highlight');
    if (l === letter && !isCorrect) btn.classList.add('incorrect');
  });

  if (sess.mode === 'study') {
    showExplanation(q, letter, isCorrect);
  } else {
    setTimeout(() => nextQuestion(), 400);
  }
}

function showExplanation(q, selected, isCorrect) {
  const expArea = document.getElementById('explanation-area');
  const isLast = App.session.current >= App.session.questions.length - 1;

  expArea.innerHTML = `
    <div class="explanation-panel fade-in">
      <div class="explanation-header">
        <span class="answer-badge ${isCorrect ? 'correct' : 'incorrect'}">
          ${isCorrect ? '✓ 正解' : '✗ 不正解'}
        </span>
        ${!isCorrect ? `<span class="correct-answer-label">正解: <strong>${q.answer}</strong></span>` : ''}
      </div>
      <div class="explanation-text">${escHtml(q.explanation)}</div>
    </div>
    <button class="btn-next" onclick="nextQuestion()">
      ${isLast ? '結果を見る' : '次の問題へ →'}
    </button>
  `;
  expArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextQuestion() {
  App.session.current++;
  if (App.session.current >= App.session.questions.length) {
    finishSession();
  } else {
    showQuestion();
  }
}

/* ---- 中断（進捗を保存してホームへ） ---- */
function confirmQuit() {
  const modeLabel = App.session?.mode === 'exam' ? '模試' : '学習';
  if (confirm(`${modeLabel}を中断しますか？\n進捗は保存され、ホーム画面から再開できます。`)) {
    if (App.timerInterval) clearInterval(App.timerInterval);
    saveSessionProgress();
    App.session = null;
    disableQuizMode();
    showHome();
    showToast('進捗を保存しました。ホームから再開できます');
  }
}

/* ---- セッション終了・結果 ---- */
function finishSession() {
  if (App.timerInterval) clearInterval(App.timerInterval);
  disableQuizMode();

  const sess = App.session;
  const answers = sess.answers;

  const chapterResults = {};
  answers.forEach(a => {
    const cid = a.question.chapter_id;
    if (!chapterResults[cid]) chapterResults[cid] = { total: 0, correct: 0 };
    chapterResults[cid].total++;
    if (a.correct) chapterResults[cid].correct++;
  });

  const totalQ = answers.length;
  const totalC = answers.filter(a => a.correct).length;

  saveSessionResult({
    date: new Date().toISOString(),
    mode: sess.mode,
    chapters: sess.selectedChapters,
    total: totalQ,
    correct: totalC,
    chapter_results: chapterResults,
    elapsed: Math.floor((Date.now() - sess.startTime) / 1000)
  });

  // 完了したので途中保存を削除
  clearSessionProgress();
  App.session = null;

  showResult(totalQ, totalC, chapterResults, sess.mode, answers);
}

/* ---- 結果画面 ---- */
function showResult(totalQ, totalC, chapterResults, mode, answers) {
  const pct = totalQ > 0 ? Math.round(totalC / totalQ * 100) : 0;
  const colorForPct = p => p >= 80 ? '#34a853' : p >= 60 ? '#f29900' : '#ea4335';

  const chapRows = Object.entries(chapterResults).map(([cid, stat]) => {
    const ch = App.data.chapters.find(c => c.id === parseInt(cid));
    const p = Math.round(stat.correct / stat.total * 100);
    const color = colorForPct(p);
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:0.85rem;">
          <span style="color:var(--text)">${ch ? `第${cid}章 ${ch.name}` : `第${cid}章`}</span>
          <span style="font-weight:600;color:${color}">${stat.correct}/${stat.total} (${p}%)</span>
        </div>
        <div class="chapter-bar-wrap">
          <div class="chapter-bar" style="width:${p}%;background:${color}"></div>
        </div>
      </div>`;
  }).join('');

  let wrongHtml = '';
  if (mode === 'exam') {
    const wrong = answers.filter(a => !a.correct);
    wrongHtml = `
      <div class="result-section">
        <h3>間違えた問題 (${wrong.length}問)</h3>
        ${wrong.slice(0, 10).map(a => `
          <div class="wrong-item">
            <div class="q-text">${escHtml(a.question.text.slice(0,120))}${a.question.text.length>120?'…':''}</div>
            <div class="answer-row">
              <span class="your-answer">あなた: ${a.selected}</span>
              <span class="right-answer">正解: ${a.question.answer}</span>
            </div>
            <div class="exp-text">${escHtml(a.question.explanation.slice(0,200))}${a.question.explanation.length>200?'…':''}</div>
          </div>
        `).join('')}
        ${wrong.length > 10 ? `<div style="text-align:center;padding:10px;font-size:0.85rem;color:var(--text-secondary)">ほか${wrong.length-10}問</div>` : ''}
      </div>`;
  }

  render(`
    <div class="screen active">
      <div class="result-hero">
        <div class="result-score">${pct}<small style="font-size:2.5rem">%</small></div>
        <div class="result-score-label">${mode === 'exam' ? '模試' : '学習'}結果</div>
        <div class="result-fraction">${totalC} / ${totalQ} 問正解</div>
      </div>
      <div class="result-content">
        <div class="result-section">
          <h3>分野別正答率</h3>
          ${chapRows}
        </div>
        ${wrongHtml}
        <button class="btn-primary" onclick="showHome()">ホームへ戻る</button>
        <button class="btn-secondary" id="retry-btn">もう一度</button>
      </div>
    </div>
  `);

  document.getElementById('retry-btn').onclick =
    () => mode === 'exam' ? showExamSetup() : showStudySetup();
}

/* ---- 成績確認画面 ---- */
function showStats() {
  const history = loadHistory();
  const chapters = App.data.chapters;

  const statsRows = chapters.slice(0,10).map(ch => {
    const s = history.chapter_stats[ch.id] || { total: 0, correct: 0 };
    if (s.total === 0) return `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bg);font-size:0.88rem;color:var(--text)">
        <span>第${ch.id}章 ${ch.name}</span>
        <span style="color:var(--text-secondary)">未回答</span>
      </div>`;
    const p = Math.round(s.correct / s.total * 100);
    const color = p >= 80 ? '#34a853' : p >= 60 ? '#f29900' : '#ea4335';
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:0.88rem;color:var(--text)">
          <span>第${ch.id}章 ${ch.name}</span>
          <span style="font-weight:600;color:${color}">${s.correct}/${s.total} (${p}%)</span>
        </div>
        <div class="chapter-bar-wrap">
          <div class="chapter-bar" style="width:${p}%;background:${color}"></div>
        </div>
      </div>`;
  }).join('');

  const sessionsHtml = history.sessions.length === 0
    ? '<div class="stats-empty">演習履歴はまだありません</div>'
    : history.sessions.slice().reverse().slice(0,20).map(sess => {
        const d = new Date(sess.date);
        const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        const p = Math.round(sess.correct / sess.total * 100);
        return `
          <div class="session-card">
            <div>
              <div class="session-mode">
                <span class="badge ${sess.mode==='exam'?'badge-exam':'badge-study'}">${sess.mode==='exam'?'模試':'学習'}</span>
                　${sess.total}問
              </div>
              <div class="session-date">${dateStr}</div>
            </div>
            <div class="session-score">${p}%</div>
          </div>`;
      }).join('');

  render(`
    <div class="screen active">
      <div class="app-header">
        <button class="btn-back" onclick="showHome()">←</button>
        <h1>成績確認</h1>
      </div>
      <div class="container">
        <div class="result-section">
          <h3>分野別累計正答率（全演習合計）</h3>
          ${statsRows || '<div style="color:var(--text-secondary);font-size:0.9rem;padding:12px 0;">まだ演習を行っていません</div>'}
        </div>
        <div class="result-section">
          <h3>演習履歴</h3>
          ${sessionsHtml}
        </div>
        <button class="btn-secondary" style="margin-top:8px" onclick="clearHistory()">履歴をクリア</button>
      </div>
    </div>
  `);
}

function clearHistory() {
  if (confirm('演習履歴をすべて削除しますか？')) {
    localStorage.removeItem(STORAGE_KEY);
    showStats();
    showToast('履歴を削除しました');
  }
}

/* ============================================================
   LocalStorage（履歴）
   ============================================================ */

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultHistory();
    const h = JSON.parse(raw);
    if (!h.sessions) h.sessions = [];
    if (!h.chapter_stats) h.chapter_stats = {};
    return h;
  } catch { return defaultHistory(); }
}

function defaultHistory() {
  return { sessions: [], chapter_stats: {} };
}

function saveSessionResult(result) {
  const h = loadHistory();
  h.sessions.push(result);
  Object.entries(result.chapter_results).forEach(([cid, stat]) => {
    if (!h.chapter_stats[cid]) h.chapter_stats[cid] = { total: 0, correct: 0 };
    h.chapter_stats[cid].total += stat.total;
    h.chapter_stats[cid].correct += stat.correct;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
}

/* ============================================================
   ユーティリティ
   ============================================================ */

function chapters1to10() {
  return App.data.chapters.filter(c => c.id >= 1 && c.id <= 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
