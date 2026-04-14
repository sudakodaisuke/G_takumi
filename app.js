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
const WRONG_KEY      = 'g_quiz_wrong';     // 間違えた問題

// ---- テーマ設定 ----
const THEMES = ['light', 'dark', 'merhen', 'metal', 'gosurori', 'nikuman', 'scandinavian'];
const THEME_ICONS = {
  light: '☀️', dark: '🌙', merhen: '🌸',
  metal: '⚡', gosurori: '🖤', nikuman: '🥟', scandinavian: '❄️'
};

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
  const names = {
    light: 'ライトモード', dark: 'ダークモード', merhen: 'メルヘンモード',
    metal: 'メタルモード', gosurori: 'ゴスロリモード',
    nikuman: '肉まんモード', scandinavian: 'スカンジナビアモード'
  };
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

// ---- 間違えた問題管理 ----
function loadWrongIds() {
  try {
    const raw = localStorage.getItem(WRONG_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveWrongIds(ids) {
  localStorage.setItem(WRONG_KEY, JSON.stringify([...ids]));
}

function updateWrongFromSession(answers) {
  const ids = loadWrongIds();
  answers.forEach(a => {
    if (!a.correct) {
      ids.add(a.question.id);
    } else {
      ids.delete(a.question.id); // 正解したら復習リストから除外
    }
  });
  saveWrongIds(ids);
}

function clearWrongIds() {
  localStorage.removeItem(WRONG_KEY);
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
    const modeLabels = { exam: '模試', study: '学習', wrong: '復習' };
    const modeLabel = modeLabels[saved.mode] || '学習';
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

  // 間違えた問題数
  const wrongCount = loadWrongIds().size;

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
          ${wrongCount > 0 ? `
          <div class="mode-card wrong-review-card" onclick="showWrongStudy()">
            <div class="mode-icon">📌</div>
            <div class="mode-name">復習モード</div>
            <div class="mode-desc">間違えた問題のみ出題<br><span class="wrong-count-badge">${wrongCount}問 積み残し</span></div>
          </div>` : ''}
          <div class="mode-card stats-card" onclick="showStats()">
            <div class="mode-icon">📊</div>
            <div class="mode-name">成績確認</div>
            <div class="mode-desc">分野別正答率・苦手分野グラフ (${totalSessions}回 / 模試${examSessions}回)</div>
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

/* ---- 復習モード（間違えた問題のみ） ---- */
function showWrongStudy() {
  const wrongIds = loadWrongIds();
  if (wrongIds.size === 0) {
    showToast('間違えた問題はありません！');
    return;
  }

  const allQ = App.data.chapters.flatMap(c => c.questions);
  const wrongQuestions = allQ.filter(q => wrongIds.has(q.id));
  if (wrongQuestions.length === 0) {
    clearWrongIds();
    showToast('問題データが一致しません。リストをリセットしました');
    showHome();
    return;
  }

  const questions = shuffle(wrongQuestions).slice(0, 50);
  App.session = {
    mode: 'wrong',
    questions,
    current: 0,
    answers: [],
    selectedChapters: [...new Set(questions.map(q => q.chapter_id))],
    startTime: Date.now(),
    remaining: null
  };
  clearSessionProgress();
  enableQuizMode();
  showQuestion();
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

  if (sess.mode === 'study' || sess.mode === 'wrong') {
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
  const modeLabels = { exam: '模試', wrong: '復習', study: '学習' };
  const modeLabel = modeLabels[App.session?.mode] || '学習';
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

  // 間違えた問題リストを更新（正解したものは除外、不正解は追加）
  updateWrongFromSession(answers);

  // 完了したので途中保存を削除
  clearSessionProgress();
  App.session = null;

  showResult(totalQ, totalC, chapterResults, sess.mode, answers);
}

/* ---- 結果画面 ---- */
function showResult(totalQ, totalC, chapterResults, mode, answers) {
  const modeLabels = { exam: '模試', wrong: '復習', study: '学習' };
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
  if (mode === 'exam' || mode === 'wrong') {
    const wrong = answers.filter(a => !a.correct);
    const remainingWrong = loadWrongIds().size;
    wrongHtml = `
      <div class="result-section">
        <h3>間違えた問題 (${wrong.length}問)</h3>
        ${wrong.length === 0
          ? '<div style="text-align:center;padding:20px;color:var(--success);font-weight:600;">全問正解！復習リストからも除外されました 🎉</div>'
          : wrong.slice(0, 10).map(a => `
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
        ${remainingWrong > 0 ? `<div style="font-size:0.82rem;color:var(--text-secondary);text-align:center;padding-top:8px;">復習リスト残り: ${remainingWrong}問</div>` : ''}
      </div>`;
  }

  render(`
    <div class="screen active">
      <div class="result-hero">
        <div class="result-score">${pct}<small style="font-size:2.5rem">%</small></div>
        <div class="result-score-label">${modeLabels[mode] || '学習'}結果</div>
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

  document.getElementById('retry-btn').onclick = () => {
    if (mode === 'exam') showExamSetup();
    else if (mode === 'wrong') showWrongStudy();
    else showStudySetup();
  };
}

/* ---- 成績確認画面 ---- */
function showStats() {
  const history = loadHistory();
  const chapters = App.data.chapters;
  const stats = history.chapter_stats;

  // 苦手分野TOP3
  const weakChapters = chapters.slice(0, 10)
    .filter(ch => (stats[ch.id] || {}).total > 0)
    .map(ch => {
      const s = stats[ch.id];
      return { ch, pct: Math.round(s.correct / s.total * 100), s };
    })
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  const weakHtml = weakChapters.length === 0 ? '' : `
    <div class="result-section">
      <h3>⚠️ 苦手分野 TOP${weakChapters.length}</h3>
      ${weakChapters.map((w, i) => `
        <div class="weak-chapter-item">
          <div>
            <div class="weak-chapter-rank">${['🥇','🥈','🥉'][i]} 第${w.ch.id}章 ${w.ch.name}</div>
            <div class="weak-chapter-sub">${w.s.correct}/${w.s.total}問正解</div>
          </div>
          <div class="weak-chapter-pct">${w.pct}%</div>
        </div>
      `).join('')}
    </div>`;

  const statsRows = chapters.slice(0,10).map(ch => {
    const s = stats[ch.id] || { total: 0, correct: 0 };
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

  const badgeMap = { exam: 'badge-exam', wrong: 'badge-wrong', study: 'badge-study' };
  const labelMap = { exam: '模試', wrong: '復習', study: '学習' };
  const sessionsHtml = history.sessions.length === 0
    ? '<div class="stats-empty">演習履歴はまだありません</div>'
    : history.sessions.slice().reverse().slice(0,20).map(sess => {
        const d = new Date(sess.date);
        const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        const p = Math.round(sess.correct / sess.total * 100);
        const badge = badgeMap[sess.mode] || 'badge-study';
        const label = labelMap[sess.mode] || '学習';
        return `
          <div class="session-card">
            <div>
              <div class="session-mode">
                <span class="badge ${badge}">${label}</span>
                　${sess.total}問
              </div>
              <div class="session-date">${dateStr}</div>
            </div>
            <div class="session-score">${p}%</div>
          </div>`;
      }).join('');

  const wrongCount = loadWrongIds().size;

  render(`
    <div class="screen active">
      <div class="app-header">
        <button class="btn-back" onclick="showHome()">←</button>
        <h1>成績確認</h1>
      </div>
      <div class="container">
        <div class="result-section">
          <h3>分野別習熟度レーダー</h3>
          <div class="radar-chart-container">
            ${renderRadarChart(stats)}
          </div>
        </div>
        ${weakHtml}
        <div class="result-section">
          <h3>分野別累計正答率（全演習合計）</h3>
          ${statsRows || '<div style="color:var(--text-secondary);font-size:0.9rem;padding:12px 0;">まだ演習を行っていません</div>'}
        </div>
        ${wrongCount > 0 ? `
        <div class="result-section">
          <h3>復習リスト</h3>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.9rem;color:var(--text)">積み残し問題: <strong style="color:var(--error)">${wrongCount}問</strong></span>
            <button onclick="showWrongStudy()" style="background:var(--error);color:white;border:none;padding:8px 16px;border-radius:var(--radius-sm);cursor:pointer;font-size:0.88rem;font-weight:600;font-family:var(--font);">復習する</button>
          </div>
          <div style="margin-top:8px;">
            <button onclick="if(confirm('復習リストをクリアしますか？')){clearWrongIds();showStats();showToast('復習リストをクリアしました');}" style="background:none;border:none;color:var(--text-secondary);font-size:0.8rem;cursor:pointer;padding:0;font-family:var(--font);">リストをクリア</button>
          </div>
        </div>` : ''}
        <div class="result-section">
          <h3>演習履歴</h3>
          ${sessionsHtml}
        </div>
        <button class="btn-secondary" style="margin-top:8px" onclick="clearHistory()">履歴をクリア</button>
      </div>
    </div>
  `);
}

/* ---- レーダーチャート（SVG） ---- */
function renderRadarChart(stats) {
  const chapters = App.data.chapters.slice(0, 10);
  const n = chapters.length;
  const cx = 150, cy = 155, r = 95;

  const hasData = chapters.some(ch => (stats[ch.id] || {}).total > 0);
  if (!hasData) {
    return '<div class="chart-no-data">演習データがありません<br>学習・模試を行うとグラフが表示されます</div>';
  }

  // グリッド円
  const gridCircles = [0.25, 0.5, 0.75, 1.0].map(ratio => {
    const gr = r * ratio;
    return `<circle cx="${cx}" cy="${cy}" r="${gr}" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.25"/>`;
  }).join('');

  // % ラベル
  const gridLabels = [25, 50, 75, 100].map((pct, i) => {
    const gr = r * (i + 1) / 4;
    return `<text x="${cx + 3}" y="${cy - gr + 4}" font-size="7" fill="currentColor" opacity="0.45">${pct}%</text>`;
  }).join('');

  // 軸線 + 章ラベル
  const axes = chapters.map((ch, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const lx = cx + (r + 20) * Math.cos(angle);
    const ly = cy + (r + 20) * Math.sin(angle);
    return `
      <line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="0.8" opacity="0.3"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="currentColor" opacity="0.75">第${ch.id}章</text>`;
  }).join('');

  // データ点
  const ratios = chapters.map(ch => {
    const s = stats[ch.id] || { total: 0, correct: 0 };
    return s.total > 0 ? s.correct / s.total : 0;
  });

  const points = chapters.map((ch, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = cx + r * ratios[i] * Math.cos(angle);
    const y = cy + r * ratios[i] * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const dots = chapters.map((ch, i) => {
    if (ratios[i] === 0) return '';
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = cx + r * ratios[i] * Math.cos(angle);
    const y = cy + r * ratios[i] * Math.sin(angle);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--primary)" stroke="var(--surface)" stroke-width="1.5"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 300 310" style="width:100%;max-width:300px;display:block;margin:0 auto;color:var(--text-secondary);">
      ${gridCircles}
      ${gridLabels}
      ${axes}
      <polygon points="${points}" fill="var(--primary)" fill-opacity="0.2" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>
      ${dots}
    </svg>`;
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
