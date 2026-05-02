"use strict";

const SETTINGS_KEY = "german_raiden_settings_v1";
const DEFAULT_SETTINGS = {
  sources: ["vocabulary"],
  questionCount: 60,
  maxHp: 100,
  startPower: 1,
  doorSpeed: 86,
  rewardMode: "heal",
  penaltyMode: "hp",
  customRows: "",
};

const sourceGrid = document.getElementById("sourceGrid");
const settingsForm = document.getElementById("settingsForm");
const questionCountInput = document.getElementById("questionCount");
const maxHpInput = document.getElementById("maxHp");
const startPowerInput = document.getElementById("startPower");
const doorSpeedSelect = document.getElementById("doorSpeed");
const rewardModeSelect = document.getElementById("rewardMode");
const penaltyModeSelect = document.getElementById("penaltyMode");
const customRowsInput = document.getElementById("customRows");
const resetBtn = document.getElementById("resetBtn");
const statusNote = document.getElementById("statusNote");

function getWordData() {
  return window.GERMAN_WORDS_DATA || { groups: [], sentences: { rows: [] }, vocabulary: [] };
}

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

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function sourceDefinitions() {
  const data = getWordData();
  const groups = data.groups || [];
  return [
    {
      id: "vocabulary",
      title: "單字題庫",
      detail: `${(data.vocabulary || []).length} 題，適合德文單字練習`,
    },
    {
      id: "sentences",
      title: "句子題庫",
      detail: `${((data.sentences && data.sentences.rows) || []).length} 題，適合完整句子辨識`,
    },
    ...groups.map((group, index) => ({
      id: `group${index}`,
      title: `群組 ${index + 1}`,
      detail: `${group.length} 題，來自 data/words.json`,
    })),
  ];
}

function renderSources(activeSources) {
  const active = new Set(activeSources);
  sourceGrid.innerHTML = "";
  for (const source of sourceDefinitions()) {
    const label = document.createElement("label");
    label.className = "check-card";
    label.innerHTML = `
      <input type="checkbox" name="sources" value="${source.id}" ${active.has(source.id) ? "checked" : ""} />
      <span>
        <b>${source.title}</b>
        <small>${source.detail}</small>
      </span>
    `;
    sourceGrid.appendChild(label);
  }
}

function renderForm(settings) {
  renderSources(settings.sources);
  questionCountInput.value = settings.questionCount;
  maxHpInput.value = settings.maxHp;
  startPowerInput.value = settings.startPower;
  doorSpeedSelect.value = String(settings.doorSpeed);
  rewardModeSelect.value = settings.rewardMode;
  penaltyModeSelect.value = settings.penaltyMode;
  customRowsInput.value = settings.customRows || "";
}

function readFormSettings() {
  const checkedSources = [...settingsForm.querySelectorAll('input[name="sources"]:checked')].map((input) => input.value);
  const customRows = customRowsInput.value.trim();
  const sources = checkedSources.length ? checkedSources : ["vocabulary"];

  return {
    sources,
    questionCount: clampNumber(questionCountInput.value, 0, 9999, DEFAULT_SETTINGS.questionCount),
    maxHp: clampNumber(maxHpInput.value, 40, 240, DEFAULT_SETTINGS.maxHp),
    startPower: clampNumber(startPowerInput.value, 1, 7, DEFAULT_SETTINGS.startPower),
    doorSpeed: clampNumber(doorSpeedSelect.value, 40, 180, DEFAULT_SETTINGS.doorSpeed),
    rewardMode: rewardModeSelect.value,
    penaltyMode: penaltyModeSelect.value,
    customRows,
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function showStatus(text, ok = false) {
  statusNote.textContent = text;
  statusNote.classList.toggle("ok", ok);
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = readFormSettings();
  saveSettings(settings);
  const selectedCount = settings.sources.length;
  showStatus(`已儲存：${selectedCount} 個資料來源、每局 ${settings.questionCount || "全部"} 題。回遊戲頁重新開始即可套用。`, true);
});

resetBtn.addEventListener("click", () => {
  saveSettings({ ...DEFAULT_SETTINGS });
  renderForm({ ...DEFAULT_SETTINGS });
  showStatus("已還原預設設定。", true);
});

renderForm(loadSettings());
