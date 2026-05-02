"use strict";

const SETTINGS_KEY = "german_raiden_settings_v1";
const DEFAULT_SETTINGS = {
  sources: ["vocabulary"],
  questionCount: 60,
  maxHp: 100,
  startPower: 1,
  doorSpeed: 86,
  rewardMode: "auto",
  penaltyMode: "auto",
  customRows: "",
};

const GERMAN_CASES = [
  { no: 1, label: "第 1 格", german: "Nominativ", zh: "主格" },
  { no: 2, label: "第 2 格", german: "Genitiv", zh: "所有格" },
  { no: 3, label: "第 3 格", german: "Dativ", zh: "與格" },
  { no: 4, label: "第 4 格", german: "Akkusativ", zh: "受格" },
];

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreText = document.getElementById("scoreText");
const hpText = document.getElementById("hpText");
const hpMeter = document.getElementById("hpMeter");
const powerText = document.getElementById("powerText");
const powerMeter = document.getElementById("powerMeter");
const progressText = document.getElementById("progressText");
const questionText = document.getElementById("questionText");
const messageText = document.getElementById("messageText");
const restartBtn = document.getElementById("restartBtn");
const leftBtn = document.getElementById("leftBtn");
const rightBtn = document.getElementById("rightBtn");

const keys = new Set();
const DOOR_START_SPEED = 24;
const DOOR_END_BONUS = 18;
const DOOR_MAX_HITS = 5;
const BULLET_SPEED = 500;
const METEOR_MAX_AMMO = 5;
const METEOR_SPEED = 560;
let holdDirection = 0;
let pointerActive = false;
let settings = loadSettings();
let questionBank = [];

const state = {
  width: 900,
  height: 620,
  running: true,
  gameOver: false,
  score: 0,
  hp: 100,
  maxHp: 100,
  power: 1,
  meteorsRemaining: METEOR_MAX_AMMO,
  waveIndex: 0,
  player: { x: 450, y: 540, w: 48, h: 54 },
  doors: [],
  bullets: [],
  particles: [],
  lastTime: 0,
  fireTimer: 0,
  currentQuestion: null,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      sources: Array.isArray(parsed.sources) && parsed.sources.length ? parsed.sources : DEFAULT_SETTINGS.sources,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function getWordData() {
  return window.GERMAN_WORDS_DATA || { groups: [], sentences: { rows: [] }, vocabulary: [] };
}

function parseRow(row, type, groupIndex = -1) {
  if (typeof row !== "string") return null;
  const parts = row.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  if (isCaseGrammarRow(type, groupIndex, parts)) {
    return GERMAN_CASES.map((caseInfo, index) => ({
      prompt: `${parts[0]}｜${caseInfo.label}（${caseInfo.german}／${caseInfo.zh}）`,
      answer: normalizeAnswer(parts[index + 1]),
      source: type,
      caseNo: caseInfo.no,
    })).filter((question) => question.answer);
  }

  const prompt = parts[0];
  let answer;
  if (type === "sentences") {
    answer = row.slice(row.indexOf(",") + 1).trim();
  } else {
    answer = parts.slice(1).join(" ");
  }
  answer = normalizeAnswer(answer);
  if (!prompt || !answer) return null;
  return { prompt, answer, source: type };
}

function normalizeAnswer(answer) {
  return String(answer).replace(/\s+/g, " ").replace(/_/g, " ").trim();
}

function isCaseGrammarRow(type, groupIndex, parts) {
  return type.startsWith("group") && groupIndex >= 2 && groupIndex <= 4 && parts.length === 5;
}

function buildQuestionBank() {
  const data = getWordData();
  const selected = new Set(settings.sources);
  const rows = [];

  if (selected.has("vocabulary")) {
    rows.push(...(data.vocabulary || []).map((row) => ({ row, type: "vocabulary" })));
  }
  if (selected.has("sentences")) {
    rows.push(...((data.sentences && data.sentences.rows) || []).map((row) => ({ row, type: "sentences" })));
  }
  (data.groups || []).forEach((group, index) => {
    if (selected.has(`group${index}`)) {
      rows.push(...group.map((row) => ({ row, type: `group${index + 1}`, groupIndex: index })));
    }
  });

  const customRows = String(settings.customRows || "")
    .split(/\n+/)
    .map((row) => row.trim())
    .filter(Boolean);
  rows.push(...customRows.map((row) => ({ row, type: "custom" })));

  const seen = new Set();
  const parsed = [];
  for (const item of rows) {
    const questions = parseRow(item.row, item.type === "sentences" ? "sentences" : item.type, item.groupIndex);
    const questionList = Array.isArray(questions) ? questions : [questions];
    for (const question of questionList) {
      if (!question) continue;
      const key = `${question.prompt}::${question.answer}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push(question);
    }
  }

  const shuffled = shuffle(parsed);
  const count = Math.max(0, Number(settings.questionCount) || 0);
  return count > 0 ? shuffled.slice(0, count) : shuffled;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.width = rect.width;
  state.height = rect.height;
  state.player.y = state.height - 96;
  state.player.x = clamp(state.player.x, 40, state.width - 40);
  if (state.doors.length) positionDoors();
}

function startGame() {
  settings = loadSettings();
  questionBank = buildQuestionBank();
  state.running = true;
  state.gameOver = false;
  state.score = 0;
  state.maxHp = clamp(Number(settings.maxHp) || 100, 40, 240);
  state.hp = state.maxHp;
  state.power = clamp(Number(settings.startPower) || 1, 1, 7);
  state.meteorsRemaining = METEOR_MAX_AMMO;
  state.waveIndex = 0;
  state.bullets = [];
  state.particles = [];
  state.fireTimer = 0;
  state.player.x = state.width / 2;

  if (questionBank.length === 0) {
    state.running = false;
    state.gameOver = true;
    questionText.textContent = "找不到題目，請到設定頁選擇資料來源。";
    setMessage("題庫是空的，請先打開設定頁確認來源。", "bad");
  } else {
    spawnWave();
    setMessage(`勇者戰機會不停發射子彈；空白鍵可發射 ${METEOR_MAX_AMMO} 發自動追蹤流星。`);
  }
  updateHud();
}

function spawnWave() {
  if (state.waveIndex >= questionBank.length) {
    state.running = false;
    state.gameOver = true;
    questionText.textContent = "本輪完成";
    setMessage(`完成 ${questionBank.length} 題，分數 ${state.score}。按重新開始再挑戰一次。`, "ok");
    return;
  }

  const current = questionBank[state.waveIndex];
  const distractor = chooseDistractor(current);
  const correctOnLeft = Math.random() < 0.5;
  state.currentQuestion = current;
  questionText.textContent = current.prompt;
  state.doors = [
    makeDoor(correctOnLeft ? current.answer : distractor.answer, correctOnLeft),
    makeDoor(correctOnLeft ? distractor.answer : current.answer, !correctOnLeft),
  ];
  positionDoors();
}

function chooseDistractor(current) {
  const sameCasePool = current.caseNo
    ? questionBank.filter((item) => item.caseNo === current.caseNo && item.answer !== current.answer)
    : [];
  const pool = sameCasePool.length ? sameCasePool : questionBank.filter((item) => item.answer !== current.answer);
  if (!pool.length) return { answer: "Nicht diese Tür" };
  return pool[Math.floor(Math.random() * pool.length)];
}

function makeDoor(label, correct) {
  return {
    label,
    correct,
    x: 0,
    y: -116,
    w: 220,
    h: 112,
    hits: 0,
    hitFlash: 0,
    flashColor: "#fff",
  };
}

function positionDoors() {
  const doorW = clamp(state.width * 0.27, 150, 230);
  const gapCenters = [state.width * 0.3, state.width * 0.7];
  state.doors.forEach((door, index) => {
    door.w = doorW;
    door.h = clamp(state.height * 0.18, 96, 124);
    door.x = gapCenters[index] - door.w / 2;
  });
}

function setMessage(text, tone = "") {
  messageText.textContent = text;
  messageText.classList.toggle("ok", tone === "ok");
  messageText.classList.toggle("bad", tone === "bad");
}

function updateHud() {
  scoreText.textContent = String(state.score);
  hpText.textContent = `${Math.max(0, Math.round(state.hp))} / ${state.maxHp}`;
  hpMeter.style.width = `${clamp((state.hp / state.maxHp) * 100, 0, 100)}%`;
  powerText.textContent = `${state.power}｜流星 ${state.meteorsRemaining}`;
  powerMeter.style.width = `${clamp((state.power / 7) * 100, 0, 100)}%`;
  progressText.textContent = `${Math.min(state.waveIndex + 1, questionBank.length)} / ${questionBank.length}`;
}

function update(delta) {
  if (!state.running) return;

  const keyboardDir = (keys.has("ArrowLeft") || keys.has("KeyA") || keys.has("a") ? -1 : 0) + (keys.has("ArrowRight") || keys.has("KeyD") || keys.has("d") ? 1 : 0);
  const verticalDir = (keys.has("ArrowUp") || keys.has("KeyW") || keys.has("w") ? -1 : 0) + (keys.has("ArrowDown") || keys.has("KeyS") || keys.has("s") ? 1 : 0);
  const direction = pointerActive ? 0 : keyboardDir || holdDirection;
  state.player.x = clamp(state.player.x + direction * 420 * delta, 38, state.width - 38);
  state.player.y = clamp(state.player.y + verticalDir * 300 * delta, state.height * 0.56, state.height - 72);

  state.fireTimer -= delta * 1000;
  const fireDelay = clamp(430 - state.power * 34, 190, 430);
  if (state.fireTimer <= 0) {
    fireBullets();
    state.fireTimer = fireDelay;
  }

  const speed = getDoorSpeed();
  for (const door of state.doors) {
    door.y += speed * delta;
    door.hitFlash = Math.max(0, door.hitFlash - delta);
  }

  for (const bullet of state.bullets) {
    if (bullet.homing) steerMeteor(bullet, delta);
    bullet.x += bullet.vx * delta;
    bullet.y += bullet.vy * delta;
    bullet.life -= delta;
  }
  state.bullets = state.bullets.filter((bullet) => bullet.y > -30 && bullet.life > 0);

  checkBulletHits();
  updateParticles(delta);

  if (state.doors.some((door) => door.y + door.h >= state.player.y + 10)) {
    applyMissPenalty();
  }
}

function getDoorSpeed() {
  const targetSpeed = Number(settings.doorSpeed) || DEFAULT_SETTINGS.doorSpeed;
  const totalWaves = Math.max(questionBank.length - 1, 1);
  const progress = clamp(state.waveIndex / totalWaves, 0, 1);
  const easedProgress = progress * progress * (3 - 2 * progress);
  return DOOR_START_SPEED + (targetSpeed - DOOR_START_SPEED) * easedProgress + progress * DOOR_END_BONUS;
}

function fireBullets() {
  const shots = clamp(state.power, 1, 7);
  const spread = shots === 1 ? [0] : Array.from({ length: shots }, (_, index) => index - (shots - 1) / 2);
  for (const offset of spread) {
    state.bullets.push({
      x: state.player.x + offset * 8,
      y: state.player.y - 30,
      vx: offset * 32,
      vy: -BULLET_SPEED,
      r: 4,
      life: 1.6,
    });
  }
}

function fireMeteor() {
  if (!state.running) {
    startGame();
    return;
  }
  if (state.meteorsRemaining <= 0) {
    setMessage("追蹤流星已用完，請靠一般子彈破門。", "bad");
    return;
  }
  const target = state.doors.find((door) => door.correct);
  if (!target) return;
  state.meteorsRemaining -= 1;
  state.bullets.push({
    x: state.player.x,
    y: state.player.y - 40,
    vx: 0,
    vy: -METEOR_SPEED,
    r: 8,
    life: 2.4,
    homing: true,
  });
  setMessage(`發射追蹤流星，剩餘 ${state.meteorsRemaining} 發。`);
  updateHud();
}

function steerMeteor(bullet, delta) {
  const target = state.doors.find((door) => door.correct);
  if (!target) return;
  const targetX = target.x + target.w / 2;
  const targetY = target.y + target.h / 2;
  const dx = targetX - bullet.x;
  const dy = targetY - bullet.y;
  const distance = Math.hypot(dx, dy) || 1;
  const desiredVx = (dx / distance) * METEOR_SPEED;
  const desiredVy = (dy / distance) * METEOR_SPEED;
  const turn = clamp(delta * 7, 0, 1);
  bullet.vx += (desiredVx - bullet.vx) * turn;
  bullet.vy += (desiredVy - bullet.vy) * turn;
}

function checkBulletHits() {
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    const door = state.doors.find((candidate) => circleHitsRect(bullet, candidate));
    if (!door) continue;
    state.bullets.splice(i, 1);
    door.hitFlash = 0.18;
    door.flashColor = door.correct ? "#5fd18d" : "#ff6b7a";
    burst(bullet.x, bullet.y, door.correct ? "#5fd18d" : "#ff6b7a", 16);
    registerDoorHit(door);
    return;
  }
}

function circleHitsRect(circle, rect) {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.w);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.h);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

function registerDoorHit(door) {
  door.hits += 1;
  const left = Math.max(DOOR_MAX_HITS - door.hits, 0);
  if (left > 0) {
    setMessage(`${door.correct ? "正確" : "錯誤"}德文門命中，還需要 ${left} 發才會破。`, door.correct ? "ok" : "bad");
    updateHud();
    return;
  }
  resolveDoorHit(door);
}

function resolveDoorHit(door) {
  if (door.correct) {
    state.score += 100 + state.power * 10;
    applyReward();
  } else {
    state.score = Math.max(0, state.score - 35);
    applyWrongPenalty();
  }

  state.waveIndex += 1;
  state.bullets = [];
  updateHud();

  if (state.hp <= 0) {
    endGame();
    return;
  }
  spawnWave();
}

function applyReward() {
  const mode = settings.rewardMode;
  const shouldHeal = mode === "heal" || (mode === "auto" && state.hp < state.maxHp * 0.62 && Math.random() < 0.55);
  if (shouldHeal) {
    const amount = 16 + state.power * 2;
    state.hp = clamp(state.hp + amount, 0, state.maxHp);
    setMessage(`命中正確德文門：血量回升 ${amount}。`, "ok");
  } else {
    state.power = clamp(state.power + 1, 1, 7);
    setMessage("命中正確德文門：火力提升。", "ok");
  }
}

function applyWrongPenalty() {
  const mode = settings.penaltyMode;
  const weaken = mode === "power" || (mode === "auto" && state.power > 1 && Math.random() < 0.58);
  if (weaken) {
    state.power = clamp(state.power - 1, 1, 7);
    setMessage("擊中錯誤德文門：火力減弱。", "bad");
  } else {
    const amount = 18;
    state.hp -= amount;
    setMessage(`擊中錯誤德文門：血量減少 ${amount}。`, "bad");
  }
}

function applyMissPenalty() {
  state.hp -= 14;
  state.waveIndex += 1;
  setMessage("兩扇門突破防線：血量減少 14。", "bad");
  state.bullets = [];
  updateHud();
  if (state.hp <= 0) {
    endGame();
    return;
  }
  spawnWave();
}

function endGame() {
  state.running = false;
  state.gameOver = true;
  questionText.textContent = "勇者戰機墜落";
  setMessage(`遊戲結束，分數 ${state.score}。按重新開始再挑戰。`, "bad");
  updateHud();
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 180;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.45 + Math.random() * 0.35,
      maxLife: 0.8,
      color,
    });
  }
}

function updateParticles(delta) {
  for (const particle of state.particles) {
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vy += 190 * delta;
    particle.life -= delta;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
}

function draw() {
  ctx.clearRect(0, 0, state.width, state.height);
  drawSpace();
  drawDoors();
  drawBullets();
  drawPlayer();
  drawParticles();
  if (state.gameOver) drawOverlay();
}

function drawSpace() {
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
  gradient.addColorStop(0, "#07122b");
  gradient.addColorStop(0.58, "#090d1c");
  gradient.addColorStop(1, "#050814");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.strokeStyle = "rgba(126, 166, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let x = -80; x < state.width + 80; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x + (performance.now() * 0.025) % 64, 0);
    ctx.lineTo(x - 160 + (performance.now() * 0.025) % 64, state.height);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  for (let i = 0; i < 42; i += 1) {
    const x = (i * 83 + performance.now() * 0.018) % state.width;
    const y = (i * 137 + performance.now() * 0.04) % state.height;
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawDoors() {
  for (const door of state.doors) {
    const glow = "rgba(126, 166, 255, 0.16)";
    const flash = door.hitFlash > 0;
    roundedRect(door.x - 9, door.y - 9, door.w + 18, door.h + 18, 22, glow);
    roundedRect(door.x, door.y, door.w, door.h, 18, flash ? door.flashColor : "#1b2754");
    ctx.strokeStyle = flash ? door.flashColor : "#7ea6ff";
    ctx.lineWidth = 3;
    strokeRoundedRect(door.x, door.y, door.w, door.h, 18);

    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(door.x + door.w / 2 - 1, door.y + 12, 2, door.h - 24);

    ctx.fillStyle = flash ? "#07122b" : "#f5f7ff";
    ctx.font = "700 17px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    wrapText(door.label, door.x + door.w / 2, door.y + door.h / 2, door.w - 22, 22);

    ctx.fillStyle = "#ffda44";
    ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`${Math.max(DOOR_MAX_HITS - door.hits, 0)} HIT`, door.x + door.w / 2, door.y + 10);
  }
}

function drawBullets() {
  for (const bullet of state.bullets) {
    ctx.beginPath();
    ctx.fillStyle = bullet.homing ? "#9df7ff" : "#f7b955";
    ctx.shadowColor = bullet.homing ? "#45d0e6" : "#ffda44";
    ctx.shadowBlur = bullet.homing ? 22 : 12;
    ctx.arc(bullet.x, bullet.y, bullet.r, 0, Math.PI * 2);
    ctx.fill();
    if (bullet.homing) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(157, 247, 255, 0.55)";
      ctx.lineWidth = 3;
      ctx.moveTo(bullet.x - bullet.vx * 0.035, bullet.y - bullet.vy * 0.035);
      ctx.lineTo(bullet.x, bullet.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
}

function drawPlayer() {
  const { x, y } = state.player;
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "#45d0e6";
  ctx.shadowBlur = 18;

  ctx.fillStyle = "#7ea6ff";
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.lineTo(22, 24);
  ctx.lineTo(0, 12);
  ctx.lineTo(-22, 24);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#f5f7ff";
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(8, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffda44";
  ctx.fillRect(-6, 24, 4, 18);
  ctx.fillRect(2, 24, 4, 18);
  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function drawOverlay() {
  ctx.fillStyle = "rgba(5, 8, 20, 0.58)";
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "800 34px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(state.hp <= 0 ? "Spiel Ende" : "Runde geschafft", state.width / 2, state.height / 2 - 24);
  ctx.font = "600 17px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("按空白鍵或「重新開始」再玩一局", state.width / 2, state.height / 2 + 14);
}

function roundedRect(x, y, w, h, r, fillStyle) {
  ctx.fillStyle = fillStyle;
  pathRoundedRect(x, y, w, h, r);
  ctx.fill();
}

function strokeRoundedRect(x, y, w, h, r) {
  pathRoundedRect(x, y, w, h, r);
  ctx.stroke();
}

function pathRoundedRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const visible = lines.slice(0, 4);
  if (lines.length > visible.length) {
    visible[visible.length - 1] = `${visible[visible.length - 1].slice(0, 20)}...`;
  }

  const startY = y - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((lineText, index) => {
    ctx.fillText(lineText, x, startY + index * lineHeight);
  });
}

function loop(time) {
  const delta = Math.min((time - state.lastTime) / 1000 || 0, 0.033);
  state.lastTime = time;
  update(delta);
  draw();
  requestAnimationFrame(loop);
}

function movePointerTo(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  state.player.x = clamp(x, 38, state.width - 38);
}

function bindEvents() {
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.key && event.key.length === 1) keys.add(event.key.toLowerCase());
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "Space" && !event.repeat) fireMeteor();
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    if (event.key && event.key.length === 1) keys.delete(event.key.toLowerCase());
  });

  canvas.addEventListener("pointerdown", (event) => {
    pointerActive = true;
    canvas.setPointerCapture(event.pointerId);
    movePointerTo(event.clientX);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointerActive) movePointerTo(event.clientX);
  });
  canvas.addEventListener("pointerup", (event) => {
    pointerActive = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", () => {
    pointerActive = false;
  });

  restartBtn.addEventListener("click", startGame);
  bindHoldButton(leftBtn, -1);
  bindHoldButton(rightBtn, 1);
}

function bindHoldButton(button, direction) {
  const start = (event) => {
    event.preventDefault();
    holdDirection = direction;
  };
  const stop = () => {
    if (holdDirection === direction) holdDirection = 0;
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointerleave", stop);
  button.addEventListener("pointercancel", stop);
}

resizeCanvas();
bindEvents();
startGame();
requestAnimationFrame(loop);
