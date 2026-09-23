(() => {
  const STORAGE_KEY = "cixu-progress-v1";
  const TODAY_KEY = "cixu-today-v1";
  const state = {
    level: "A",
    view: "study",
    queue: [],
    queueIndex: 0,
    revealed: false,
    ratings: { known: 0, fuzzy: 0, unknown: 0 },
    progress: loadJSON(STORAGE_KEY, {}),
    today: loadToday(),
    libraryFilter: "all",
    reviewType: null,
    spellEntry: null,
  };

  const $ = (id) => document.getElementById(id);
  const levels = window.VOCAB_DATA;
  const speechEngine = "speechSynthesis" in window ? window.speechSynthesis : null;
  let preferredVoice = null;
  let speechTimer = null;

  function prepareSpeech() {
    if (!speechEngine) return;
    const voices = speechEngine.getVoices();
    preferredVoice = voices.find((voice) => voice.lang === "en-US" && voice.localService)
      || voices.find((voice) => voice.lang === "en-US")
      || voices.find((voice) => voice.lang.startsWith("en"))
      || null;
  }

  prepareSpeech();
  if (speechEngine) {
    speechEngine.addEventListener?.("voiceschanged", prepareSpeech);
    document.addEventListener("pointerdown", () => {
      prepareSpeech();
      speechEngine.resume();
    }, { once: true, passive: true });
  }

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }

  function loadToday() {
    const today = new Date().toISOString().slice(0, 10);
    const saved = loadJSON(TODAY_KEY, { date: today, count: 0 });
    return saved.date === today ? saved : { date: today, count: 0 };
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    localStorage.setItem(TODAY_KEY, JSON.stringify(state.today));
  }

  function entryKey(entry, level = state.level) { return `${level}:${entry.w}`; }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function setQueue(entries = levels[state.level], type = null) {
    state.reviewType = type;
    state.queue = shuffle(entries);
    state.queueIndex = 0;
    state.revealed = false;
    state.ratings = { known: 0, fuzzy: 0, unknown: 0 };
    renderStudy();
  }

  function currentEntry() { return state.queue[state.queueIndex] || levels[state.level][0]; }

  function renderStudy() {
    const entry = currentEntry();
    if (!entry) return;
    $("currentWord").textContent = entry.w;
    $("currentMeaning").textContent = entry.m;
    $("cardLevel").textContent = `${state.level} · ${state.reviewType ? "薄弱复习" : "学习卡"}`;
    $("cardPosition").textContent = `${Math.min(state.queueIndex + 1, state.queue.length)} / ${state.queue.length}`;
    $("currentMeaning").hidden = !state.revealed;
    document.querySelector(".meaning-placeholder").hidden = state.revealed;
    $("revealBtn").hidden = state.revealed;
    $("ratingRow").hidden = !state.revealed;
    const answered = Object.values(state.ratings).reduce((a, b) => a + b, 0);
    $("sessionSummary").textContent = answered ? `认识 ${state.ratings.known} · 模糊 ${state.ratings.fuzzy} · 不会 ${state.ratings.unknown}` : "本轮尚未作答";
    $("sessionBar").style.width = `${state.queue.length ? (state.queueIndex / state.queue.length) * 100 : 0}%`;
  }

  function reveal() {
    if (state.revealed) return;
    state.revealed = true;
    renderStudy();
  }

  function rate(rating) {
    if (!state.revealed) return;
    const entry = currentEntry();
    const key = entryKey(entry);
    const previous = state.progress[key] || {};
    state.progress[key] = { ...previous, status: rating, seen: (previous.seen || 0) + 1, updatedAt: Date.now() };
    state.ratings[rating] += 1;
    state.today.count += 1;
    saveProgress();
    state.queueIndex += 1;
    if (state.queueIndex >= state.queue.length) {
      setQueue(state.reviewType ? getReviewEntries(state.reviewType) : levels[state.level], state.reviewType);
      showToast("本轮完成，已重新打乱");
    } else {
      state.revealed = false;
      renderStudy();
    }
    updateStats();
  }

  function statusCounts(level = state.level) {
    const counts = { known: 0, fuzzy: 0, unknown: 0, new: 0 };
    levels[level].forEach((entry) => {
      const status = state.progress[entryKey(entry, level)]?.status || "new";
      counts[status] += 1;
    });
    return counts;
  }

  function updateStats() {
    const counts = statusCounts();
    const total = levels[state.level].length;
    const percent = Math.round((counts.known / total) * 100);
    $("todayCount").textContent = state.today.count;
    $("levelLabel").textContent = `${state.level}级`;
    $("knownTotal").textContent = counts.known;
    $("fuzzyTotal").textContent = counts.fuzzy;
    $("unknownTotal").textContent = counts.unknown;
    $("masteryPercent").textContent = `${percent}%`;
    $("progressRing").style.setProperty("--progress", percent);
    $("reviewFuzzyCount").textContent = counts.fuzzy;
    $("reviewUnknownCount").textContent = counts.unknown;
    $("reviewEmpty").classList.toggle("show", counts.fuzzy + counts.unknown === 0);
  }

  function speak(word) {
    if (!speechEngine) return showToast("当前浏览器不支持朗读");
    prepareSpeech();
    const needsReset = speechEngine.speaking || speechEngine.pending;
    if (needsReset) speechEngine.cancel();
    clearTimeout(speechTimer);
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    if (preferredVoice) utterance.voice = preferredVoice;
    const play = () => {
      speechEngine.resume();
      speechEngine.speak(utterance);
    };
    if (needsReset) speechTimer = setTimeout(play, 20);
    else play();
  }

  function setLevel(level) {
    state.level = level;
    document.querySelectorAll(".level-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.level === level));
    $("libraryLevel").textContent = level;
    setQueue();
    chooseSpellEntry();
    updateStats();
    renderLibrary();
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
    document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
    if (view === "library") renderLibrary();
    if (view === "review") updateStats();
    if (view === "spell") setTimeout(() => $("spellInput").focus(), 50);
  }

  function chooseSpellEntry() {
    const list = levels[state.level];
    state.spellEntry = list[Math.floor(Math.random() * list.length)];
    $("spellLevel").textContent = state.level;
    $("spellMeaning").textContent = state.spellEntry.m;
    $("spellInput").value = "";
    $("spellResult").textContent = "";
    $("spellResult").className = "spell-result";
  }

  function checkSpelling(event) {
    event.preventDefault();
    const input = $("spellInput").value.trim().toLocaleLowerCase();
    if (!input) return;
    const answer = state.spellEntry.w.toLocaleLowerCase();
    const correct = input === answer;
    $("spellResult").textContent = correct ? "正确！按 Enter 继续。" : `正确答案：${state.spellEntry.w}`;
    $("spellResult").className = `spell-result ${correct ? "correct" : "wrong"}`;
    const key = entryKey(state.spellEntry);
    const old = state.progress[key] || {};
    state.progress[key] = { ...old, status: correct ? "known" : "unknown", spellCorrect: (old.spellCorrect || 0) + (correct ? 1 : 0), spellWrong: (old.spellWrong || 0) + (correct ? 0 : 1), updatedAt: Date.now() };
    state.today.count += 1;
    saveProgress();
    updateStats();
    setTimeout(chooseSpellEntry, correct ? 650 : 1500);
  }

  function getReviewEntries(type) {
    return levels[state.level].filter((entry) => state.progress[entryKey(entry)]?.status === type);
  }

  function startReview(type) {
    const entries = getReviewEntries(type);
    if (!entries.length) return showToast(type === "fuzzy" ? "暂无模糊词" : "暂无不会的词");
    setQueue(entries, type);
    setView("study");
  }

  function renderLibrary() {
    const query = $("searchInput").value.trim().toLocaleLowerCase();
    const entries = levels[state.level].filter((entry) => {
      const status = state.progress[entryKey(entry)]?.status || "new";
      const matchesFilter = state.libraryFilter === "all" || status === state.libraryFilter;
      const matchesQuery = !query || entry.w.toLocaleLowerCase().includes(query) || entry.m.includes(query);
      return matchesFilter && matchesQuery;
    });
    const shown = entries.slice(0, 240);
    $("wordList").innerHTML = shown.map((entry) => {
      const status = state.progress[entryKey(entry)]?.status || "new";
      return `<article class="word-item"><div class="word-item-top"><i class="status-mark ${status}"></i><strong>${escapeHTML(entry.w)}</strong></div><p>${escapeHTML(entry.m)}</p></article>`;
    }).join("");
    $("listCount").textContent = entries.length > shown.length ? `显示前 ${shown.length} 项，共 ${entries.length} 项` : `共 ${entries.length} 项`;
  }

  function escapeHTML(value) {
    return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("show");
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
  }

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => {
      try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {}
    };
    register({
      name: "get_learning_progress",
      title: "查看词汇学习进度",
      description: "读取指定等级的认识、模糊、不会和未学习词数。",
      inputSchema: {
        type: "object",
        properties: { level: { type: "string", enum: ["A", "B", "C"] } },
        required: ["level"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        if (!input || !["A", "B", "C"].includes(input.level)) throw new Error("level must be A, B, or C");
        return { level: input.level, total: levels[input.level].length, ...statusCounts(input.level) };
      },
    });
    register({
      name: "select_vocabulary_level",
      title: "选择词汇等级",
      description: "切换到 A、B 或 C 级词汇并重新开始随机学习队列。",
      inputSchema: {
        type: "object",
        properties: { level: { type: "string", enum: ["A", "B", "C"] } },
        required: ["level"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["A", "B", "C"].includes(input.level)) throw new Error("level must be A, B, or C");
        setLevel(input.level);
        setView("study");
        return { level: state.level, queueSize: state.queue.length, view: state.view };
      },
    });
    register({
      name: "start_weak_word_review",
      title: "开始薄弱词复习",
      description: "开始复习当前等级中标记为模糊或不会的单词。",
      inputSchema: {
        type: "object",
        properties: { type: { type: "string", enum: ["fuzzy", "unknown"] } },
        required: ["type"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["fuzzy", "unknown"].includes(input.type)) throw new Error("type must be fuzzy or unknown");
        const entries = getReviewEntries(input.type);
        if (!entries.length) return { started: false, reason: "no_matching_words", level: state.level };
        startReview(input.type);
        return { started: true, level: state.level, type: input.type, queueSize: entries.length };
      },
    });
  }

  document.querySelectorAll(".level-btn").forEach((btn) => btn.addEventListener("click", () => setLevel(btn.dataset.level)));
  document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  document.querySelectorAll(".rating").forEach((btn) => btn.addEventListener("click", () => rate(btn.dataset.rating)));
  document.querySelectorAll(".review-start").forEach((btn) => btn.addEventListener("click", () => startReview(btn.dataset.type)));
  document.querySelectorAll(".filter-btn").forEach((btn) => btn.addEventListener("click", () => {
    state.libraryFilter = btn.dataset.filter;
    document.querySelectorAll(".filter-btn").forEach((item) => item.classList.toggle("active", item === btn));
    renderLibrary();
  }));

  $("revealBtn").addEventListener("click", reveal);
  $("wordCard").addEventListener("dblclick", reveal);
  $("speakBtn").addEventListener("click", () => speak(currentEntry().w));
  $("reshuffleBtn").addEventListener("click", () => { setQueue(); showToast("已重新打乱"); });
  $("spellForm").addEventListener("submit", checkSpelling);
  $("nextSpellBtn").addEventListener("click", chooseSpellEntry);
  $("spellSpeakBtn").addEventListener("click", () => speak(state.spellEntry.w));
  $("searchInput").addEventListener("input", renderLibrary);

  document.addEventListener("keydown", (event) => {
    if (state.view !== "study" || ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (event.code === "Space") { event.preventDefault(); reveal(); }
    if (state.revealed && ["1", "2", "3"].includes(event.key)) rate({ "1": "unknown", "2": "fuzzy", "3": "known" }[event.key]);
    if (event.key.toLowerCase() === "r") speak(currentEntry().w);
  });

  setQueue();
  chooseSpellEntry();
  updateStats();
  renderLibrary();
  registerWebMCP();
})();
