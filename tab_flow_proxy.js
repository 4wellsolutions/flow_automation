const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const readlineSync = require('readline-sync');
const https = require('https');

// ========== CONFIGURATION HOLDER ==========
let CONFIG = {
  COOKIES_DIR: "d:\\workspace\\flow\\cookies",
  PROMPTS_DIR: "d:\\workspace\\flow\\prompts",
  DOWNLOAD_BASE_DIR: "d:\\workspace\\flow\\Videos",
  PROXY_FILE: "d:\\workspace\\flow\\proxy.txt",
  MAX_TABS: 2,
  ASPECT_RATIO: '',
  MODEL_PREFERENCE: '',
  OVERWRITE_MODE: true,
  TIMEOUT_SECONDS: 300,  // Fixed Default
  MAX_ACCOUNTS: 1,       // Will be updated by user input
  POLL_MS: 1000,
  TAB_OPEN_DELAY: 2000,
  DOWNLOAD_TIMEOUT: 60000,
  INTERNET_CHECK_RETRY_DELAY: 30000,
  ACTION_RETRIES: 5,
  ACTION_RETRY_DELAY: 3000,
  NAV_RETRIES: 3
};

// Global variables
let SCRIPT_START_TIME = null;
let GLOBAL_PROMPT_QUEUE = [];
let GLOBAL_PROMPT_INDEX = 0;
const QUEUE_LOCK = { locked: false };
let TOTAL_VIDEOS_COMPLETED = 0;
let TOTAL_VIDEOS_FAILED = 0;
let TOTAL_VIDEOS_SKIPPED = 0;
const PROMPT_FILE_STATUS = new Map();
let INTERNET_LAST_STATUS = true;

// ========== 1. INPUTS & SETUP ==========

function getUserConfiguration(totalAccounts) {
  console.clear();
  console.log("=".repeat(60));
  console.log("      VEO STEALTH AUTOMATION (WebRTC Fix + Randomizer)");
  console.log("=".repeat(60));
  console.log(`📋 Found ${totalAccounts} Total Accounts available.\n`);

  // 1. Account Limit (MOVED TO TOP)
  let maxAccounts = readlineSync.questionInt(`❓ How many Browser Windows (Accounts) to run concurrently? (Max ${totalAccounts}): `);
  if (maxAccounts > totalAccounts) maxAccounts = totalAccounts;
  if (maxAccounts <= 0) maxAccounts = 1;
  CONFIG.MAX_ACCOUNTS = maxAccounts;
  console.log(`▶️ Will run ${CONFIG.MAX_ACCOUNTS} random accounts.\n`);

  // 2. Model
  console.log('Select Model Preference:');
  console.log('  1. Veo 3.1 - Fast (Standard)');
  console.log('  2. Veo 3.1 - Fast [Lower Priority] (Zero Credit)');
  const modelChoice = readlineSync.questionInt('Enter choice (1 or 2): ');
  CONFIG.MODEL_PREFERENCE = modelChoice === 2 ? 'Veo 3.1 - Fast [Lower Priority]' : 'Veo 3.1 - Fast';
  console.log(`▶️ Selected: ${CONFIG.MODEL_PREFERENCE}\n`);

  // 3. Tabs
  CONFIG.MAX_TABS = readlineSync.questionInt('Tabs per Browser (e.g. 2): ');
  console.log(`▶️ ${CONFIG.MAX_TABS} tabs per window.\n`);

  // 4. Aspect Ratio
  console.log('Select Aspect Ratio:');
  console.log('  1. Landscape (16:9)');
  console.log('  2. Portrait (9:16)');
  const arChoice = readlineSync.questionInt('Enter choice (1 or 2): ');
  CONFIG.ASPECT_RATIO = arChoice === 2 ? 'Portrait (9:16)' : 'Landscape (16:9)';
  console.log(`▶️ Selected: ${CONFIG.ASPECT_RATIO}\n`);

  // 5. File Handling
  console.log('File Handling:');
  console.log('  1. Overwrite existing videos');
  console.log('  2. Skip existing videos (Resume Mode)');
  const owChoice = readlineSync.questionInt('Enter choice (1 or 2): ');
  CONFIG.OVERWRITE_MODE = owChoice !== 2;
  console.log(`▶️ Mode: ${CONFIG.OVERWRITE_MODE ? 'Overwrite' : 'Resume'}\n`);

  // 6. Timeout (Silent Default)
  console.log(`▶️ Timeout set to default: ${CONFIG.TIMEOUT_SECONDS}s\n`);
}

// ========== 2. PROXY & FINGERPRINT ==========

function loadProxies() {
  if (!fs.existsSync(CONFIG.PROXY_FILE)) {
    console.log(`⚠️ Proxy file not found at ${CONFIG.PROXY_FILE}. Proceeding without proxies.`);
    return [];
  }
  const content = fs.readFileSync(CONFIG.PROXY_FILE, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const proxies = lines.map(line => {
    const parts = line.split(':');
    if (parts.length === 4) {
      return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
    }
    return null;
  }).filter(p => p !== null);
  console.log(`🛡️ Loaded ${proxies.length} proxies.`);
  return proxies;
}

async function testProxies(proxies) {
  if (proxies.length === 0) return [];
  console.log("\n🚦 Testing proxies (Checking first 5)...");
  const validProxies = [];
  const browser = await chromium.launch({ headless: true });

  const batch = proxies.slice(0, 5);
  const promises = batch.map(async (proxy) => {
    const context = await browser.newContext({ proxy: proxy });
    const page = await context.newPage();
    try {
      await page.goto('http://detectportal.firefox.com/success.txt', { timeout: 8000 });
      validProxies.push(proxy);
      process.stdout.write("✅ ");
    } catch (e) {
      process.stdout.write("❌ ");
    } finally {
      await context.close();
    }
  });

  await Promise.all(promises);
  await browser.close();
  console.log(`\n✅ Proxy Test Done. Using full list.`);
  return proxies;
}

function generateFingerprint() {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  ];
  return {
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: ['geolocation'],
    colorScheme: Math.random() > 0.5 ? 'dark' : 'light'
  };
}

// ========== 3. STEALTH INJECTION ==========
async function injectStealthScripts(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {}, loadTimes: function () { }, csi: function () { }, app: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : originalQuery(parameters)
    );
  });
}

// ========== 4. GENERIC HELPERS ==========
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function executeWithRetry(fn, description, windowIdx, tabIndex, retries = CONFIG.ACTION_RETRIES) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`⚠️ [W${windowIdx}-T${tabIndex}] Retry ${i}/${retries}: ${description}`);
      if (i === retries) throw error;
      await sleep(CONFIG.ACTION_RETRY_DELAY);
      await checkInternetConnection(windowIdx, tabIndex);
    }
  }
}

async function checkInternetConnection(windowIdx = null, tabIndex = null) {
  const prefix = windowIdx ? `[W${windowIdx}]` : '';
  while (true) {
    try {
      await new Promise((resolve, reject) => {
        const req = https.get('https://www.google.com', { timeout: 5000 }, (res) => resolve(true));
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });
      if (!INTERNET_LAST_STATUS) {
        console.log(`\n✅ ${prefix} Internet restored.`);
        INTERNET_LAST_STATUS = true;
      }
      return true;
    } catch (error) {
      if (INTERNET_LAST_STATUS) {
        console.log(`\n⚠️ ${prefix} Internet lost! Waiting...`);
        INTERNET_LAST_STATUS = false;
      }
      await sleep(CONFIG.INTERNET_CHECK_RETRY_DELAY);
    }
  }
}

// ========== 5. FILE MANAGEMENT ==========
function initializePromptFileTracking(prompts) {
  const filePromptCounts = new Map();
  prompts.forEach(prompt => {
    const count = filePromptCounts.get(prompt.filename) || 0;
    filePromptCounts.set(prompt.filename, count + 1);
  });
  filePromptCounts.forEach((totalCount, filename) => {
    PROMPT_FILE_STATUS.set(filename, { total: totalCount, completed: 0, failed: 0, skipped: 0 });
  });
  console.log("\n📊 Prompt Tracking:");
  PROMPT_FILE_STATUS.forEach((status, filename) => {
    console.log(`   ${filename}.txt: ${status.total} prompts`);
  });
}

function checkAndMovePromptFile(filename) {
  const status = PROMPT_FILE_STATUS.get(filename);
  if (!status) return;
  const totalProcessed = status.completed + status.failed + status.skipped;
  if (totalProcessed === status.total) {
    const sourceFile = path.join(CONFIG.PROMPTS_DIR, `${filename}.txt`);
    const destDir = getDownloadDir(filename);
    const destFile = path.join(destDir, `${filename}.txt`);
    try {
      if (fs.existsSync(sourceFile)) {
        ensureDownloadDirExists(filename);
        fs.renameSync(sourceFile, destFile);
        console.log(`\n📦 [MOVED] ${filename}.txt -> Finished Folder`);
      }
    } catch (e) { }
  }
}

function logFailedPromptToFiles(tabData) {
  const globalFailPath = path.join(CONFIG.PROMPTS_DIR, "prompts_fail.txt");
  const entry = `Prompt #${tabData.promptIndex} (${tabData.cookieFileName}):\n${tabData.promptText}\n\n`;
  try { fs.appendFileSync(globalFailPath, entry, "utf8"); } catch (e) { }
}

function normalizeCookies(raw) {
  const arr = Array.isArray(raw) ? raw : raw.cookies || [];
  return arr.map((c) => ({
    name: c.name, value: c.value, domain: c.domain?.replace(/^https?:\/\//, "") || "",
    path: c.path || "/", httpOnly: !!c.httpOnly, secure: !!c.secure,
    sameSite: ["Lax", "None", "Strict"].includes(c.sameSite) ? c.sameSite : "Lax",
  }));
}

function loadAllCookieSets() {
  if (!fs.existsSync(CONFIG.COOKIES_DIR)) throw new Error(`Cookies dir missing`);
  const files = fs.readdirSync(CONFIG.COOKIES_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) throw new Error(`No .json cookies found`);

  const accountSets = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(CONFIG.COOKIES_DIR, file), "utf8");
      const cookies = normalizeCookies(JSON.parse(content));
      accountSets.push({ fileName: file, cookies: cookies });
    } catch (e) { console.error(`Error reading ${file}: ${e.message}`); }
  }
  return accountSets;
}

function checkIfVideoExists(filename, promptIndex) {
  const videoDir = getDownloadDir(filename);
  return fs.existsSync(path.join(videoDir, `${promptIndex}.mp4`));
}

async function getNextPrompt() {
  while (QUEUE_LOCK.locked) await sleep(10);
  QUEUE_LOCK.locked = true;
  while (GLOBAL_PROMPT_INDEX < GLOBAL_PROMPT_QUEUE.length) {
    const prompt = GLOBAL_PROMPT_QUEUE[GLOBAL_PROMPT_INDEX];
    const index = GLOBAL_PROMPT_INDEX;

    if (!CONFIG.OVERWRITE_MODE && checkIfVideoExists(prompt.filename, prompt.promptIndex)) {
      console.log(`\n⏭️ SKIPPED: ${prompt.filename} #${prompt.promptIndex}`);
      TOTAL_VIDEOS_SKIPPED++;
      const status = PROMPT_FILE_STATUS.get(prompt.filename);
      if (status) { status.skipped++; checkAndMovePromptFile(prompt.filename); }
      GLOBAL_PROMPT_INDEX++;
      continue;
    }
    GLOBAL_PROMPT_INDEX++;
    QUEUE_LOCK.locked = false;
    return { prompt, globalIndex: index + 1 };
  }
  QUEUE_LOCK.locked = false;
  return null;
}

function getRemainingPrompts() { return GLOBAL_PROMPT_QUEUE.length - GLOBAL_PROMPT_INDEX; }

function loadAllPromptsFromFiles() {
  console.log("\n📂 Loading prompts...");
  const files = fs.readdirSync(CONFIG.PROMPTS_DIR).filter((f) => f.endsWith(".txt") && !f.includes('fail') && !f.includes('success')).sort();
  const allPrompts = [];
  for (const file of files) {
    const baseName = path.parse(file).name;
    const content = fs.readFileSync(path.join(CONFIG.PROMPTS_DIR, file), "utf8");
    let prompts = /Scene\s+\d+/i.test(content)
      ? content.split(/(?=Scene\s+\d+)/gi)
      : content.split(/\n\s*\n/);

    prompts = prompts.map(p => p.trim()).filter(p => p.length > 0);
    prompts.forEach((p, i) => allPrompts.push({ filename: baseName, promptIndex: i + 1, text: p }));
    console.log(` ✓ ${file}: ${prompts.length} prompts`);
  }
  return allPrompts;
}

function getDownloadDir(filename) { return path.join(CONFIG.DOWNLOAD_BASE_DIR, filename); }
function ensureDownloadDirExists(filename) {
  const dir = getDownloadDir(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ========== 6. PAGE AUTOMATION ==========

async function openNewTab(context, tabIndex, windowIdx) {
  await checkInternetConnection(windowIdx, tabIndex);
  const page = await context.newPage();
  await injectStealthScripts(page);
  return page;
}

async function navigateToFlowHome(page, tabIndex, windowIdx) {
  for (let i = 1; i <= CONFIG.NAV_RETRIES; i++) {
    try {
      await checkInternetConnection(windowIdx, tabIndex);
      console.log(`[W${windowIdx}-T${tabIndex}] 🌐 Navigating to Flow...`);
      await page.goto("https://labs.google/fx/tools/flow/", { waitUntil: "domcontentloaded", timeout: 45000 });
      return;
    } catch (e) {
      if (i === CONFIG.NAV_RETRIES) throw e;
      await page.reload().catch(() => { });
      await sleep(2000);
    }
  }
}

async function clickNewProject(page, tabIndex, windowIdx) {
  await page.waitForSelector('button:has-text("New project")', { timeout: 30000 });
  await page.click('button:has-text("New project")');
  await page.waitForURL("**/flow/project/**", { timeout: 45000 });
}

async function configureProjectSettings(page, tabIndex, windowIdx) {
  try {
    const settingsBtn = page.locator('button:has(i:text("tune")), [aria-label="Settings"]');
    await settingsBtn.waitFor({ state: "visible", timeout: 10000 });
    await settingsBtn.click();
    await sleep(1000);

    const popover = page.locator('[role="dialog"], [role="menu"]').last();

    // Model
    try {
      const modelDropdown = popover.locator('button[role="combobox"]').filter({ has: page.locator('span:has-text("Model")') });
      if (await modelDropdown.count() > 0) {
        await modelDropdown.click({ force: true });
        await sleep(500);
        const target = page.locator('[role="option"]').filter({ hasText: CONFIG.MODEL_PREFERENCE }).first();
        if (await target.isVisible()) await target.click({ force: true });
        await sleep(500);
      }
    } catch (e) { }

    // Ratio
    try {
      const ratioDropdown = popover.locator('button[role="combobox"]').filter({ has: page.locator('span:has-text("Aspect Ratio")') });
      await ratioDropdown.click({ force: true });
      const ratioTxt = CONFIG.ASPECT_RATIO.includes('Portrait') ? 'Portrait (9:16)' : 'Landscape (16:9)';
      const target = page.locator('[role="option"]').filter({ hasText: ratioTxt }).last();
      await target.click({ force: true });
      await sleep(500);
    } catch (e) { }

    // Outputs = 1
    try {
      const outputDropdown = popover.locator('button[role="combobox"]').filter({ has: page.locator('span:has-text("Outputs per prompt")') });
      if (await outputDropdown.count() > 0) {
        await outputDropdown.click({ force: true });
        const oneOpt = page.locator('[role="option"]').filter({ hasText: /^1$/ }).first();
        if (await oneOpt.isVisible()) await oneOpt.click({ force: true });
        else {
          await page.evaluate(() => {
            document.querySelectorAll('[role="option"]').forEach(o => { if (o.textContent.includes("1")) o.click(); });
          });
        }
      }
    } catch (e) { }

    await settingsBtn.click({ force: true });
  } catch (e) {
    console.log(`[W${windowIdx}-T${tabIndex}] Settings warning: ${e.message}`);
  }
}

async function pasteAndSubmitPrompt(page, promptText, tabIndex, windowIdx) {
  await checkInternetConnection(windowIdx, tabIndex);
  const input = await page.waitForSelector('textarea, input[type="text"], div[contenteditable="true"]', { timeout: 30000 });
  await input.click({ clickCount: 3 });
  await input.press("Backspace");
  await input.fill(promptText);
  await page.locator("button:has-text('Generate'), button:has-text('Submit'), button:has-text('Create')").first().click();
}

async function getVideoStatus(page) {
  try {
    return await page.evaluate(() => {
      const card = document.querySelector('[data-index="1"]');
      if (!card) return "pending";
      if (Array.from(card.querySelectorAll('button i.google-symbols')).some(el => el.textContent.includes('download'))) return "complete";
      if (/failed/i.test(card.innerText)) return "failed";
      return "pending";
    });
  } catch (e) { return "error"; }
}

async function downloadCompletedVideo(page, tabIndex, windowIdx, filename, promptIndex) {
  try {
    await checkInternetConnection(windowIdx, tabIndex);
    if (page.isClosed()) return false;

    let button = null;
    for (let i = 0; i < 3; i++) {
      const card = await page.waitForSelector('[data-index="1"]', { timeout: 10000 }).catch(() => null);
      if (card) {
        button = await card.$('button:has(i.google-symbols:text("download"))').catch(() => null);
        if (button) break;
      }
      await sleep(1000);
    }
    if (!button) return false;

    const downloadPromise = page.waitForEvent('download', { timeout: CONFIG.DOWNLOAD_TIMEOUT }).catch(() => null);
    await button.click();

    try {
      const orig = await page.waitForSelector('div[role="menuitem"]:has-text("Original size")', { timeout: 3000 }).catch(() => null);
      if (orig) await orig.click();
    } catch (e) { }

    const download = await downloadPromise;
    if (!download) return false;

    const savePath = path.join(ensureDownloadDirExists(filename), `${promptIndex}.mp4`);
    await download.saveAs(savePath).catch(() => false);
    return fs.existsSync(savePath);
  } catch (e) { return false; }
}

// ========== 7. ORCHESTRATION ==========

async function setupNewTabWithPrompt(context, promptData, tabIndex, windowIdx, globalIndex, cookieFileName) {
  try {
    console.log(`\n📋 [W${windowIdx}-T${tabIndex}] Setup Global #${globalIndex}`);
    const page = await executeWithRetry(() => openNewTab(context, tabIndex, windowIdx), "Open", windowIdx, tabIndex);
    await navigateToFlowHome(page, tabIndex, windowIdx);
    await executeWithRetry(() => clickNewProject(page, tabIndex, windowIdx), "New Proj", windowIdx, tabIndex);
    await executeWithRetry(() => configureProjectSettings(page, tabIndex, windowIdx), "Settings", windowIdx, tabIndex);
    await executeWithRetry(() => pasteAndSubmitPrompt(page, promptData.text, tabIndex, windowIdx), "Submit", windowIdx, tabIndex);

    return { page, promptText: promptData.text, filename: promptData.filename, promptIndex: promptData.promptIndex, globalIndex, startTime: Date.now(), status: "pending", cookieFileName, retryCount: 0 };
  } catch (e) {
    console.log(`❌ [W${windowIdx}-T${tabIndex}] Setup failed: ${e.message}`);
    if (context.pages().length > tabIndex) try { context.pages()[tabIndex]?.close(); } catch (ex) { }
    return null;
  }
}

async function closeTabAndCleanup(tabData) {
  try { if (tabData && tabData.page && !tabData.page.isClosed()) await tabData.page.close().catch(() => { }); } catch (e) { }
}

async function handleCompletedVideo(tabData, tabIndex, windowIdx) {
  console.log(`\n🎉 [W${windowIdx}-T${tabIndex}] COMPLETE! #${tabData.globalIndex}`);
  const success = await downloadCompletedVideo(tabData.page, tabIndex, windowIdx, tabData.filename, tabData.promptIndex);
  if (success) {
    TOTAL_VIDEOS_COMPLETED++;
    const s = PROMPT_FILE_STATUS.get(tabData.filename); if (s) { s.completed++; checkAndMovePromptFile(tabData.filename); }
  } else {
    TOTAL_VIDEOS_FAILED++;
    logFailedPromptToFiles(tabData);
    const s = PROMPT_FILE_STATUS.get(tabData.filename); if (s) { s.failed++; checkAndMovePromptFile(tabData.filename); }
  }
  await closeTabAndCleanup(tabData);
}

async function handleFailed(tabData, tabIndex, windowIdx) {
  TOTAL_VIDEOS_FAILED++;
  logFailedPromptToFiles(tabData);
  const s = PROMPT_FILE_STATUS.get(tabData.filename); if (s) { s.failed++; checkAndMovePromptFile(tabData.filename); }
  console.log(`❌ [W${windowIdx}-T${tabIndex}] FAILED!`);
  await closeTabAndCleanup(tabData);
}

async function runOneWindow(browser, cookies, windowIdx, cookieFileName, assignedProxy) {
  try {
    console.log(`\n🌐 [Window ${windowIdx}] Launching (${cookieFileName})...`);
    if (assignedProxy) console.log(`🛡️ [Window ${windowIdx}] Proxy: ${assignedProxy.server}`);

    const fingerprint = generateFingerprint();
    const context = await browser.newContext({
      viewport: null,
      acceptDownloads: true,
      userAgent: fingerprint.userAgent,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      permissions: ['geolocation'],
      proxy: assignedProxy || undefined,
      ignoreHTTPSErrors: true
    });
    await context.addCookies(cookies);

    // Check IP
    try {
      const p = await context.newPage();
      await p.goto('https://api.ipify.org', { timeout: 8000 });
      console.log(`🕵️ [Window ${windowIdx}] Detected IP: ${await p.innerText('body')}`);
      await p.close();
    } catch (e) { console.log(`⚠️ [Window ${windowIdx}] IP check skipped`); }

    const activeTabs = new Map();
    // Init
    for (let i = 1; i <= CONFIG.MAX_TABS; i++) {
      const next = await getNextPrompt();
      if (!next) break;
      const data = await setupNewTabWithPrompt(context, next.prompt, i, windowIdx, next.globalIndex, cookieFileName);
      if (data) activeTabs.set(i, data);
      await sleep(CONFIG.TAB_OPEN_DELAY);
    }

    // Loop
    while (activeTabs.size > 0 || getRemainingPrompts() > 0) {
      for (const [tIdx, tData] of [...activeTabs.entries()]) {
        tData.status = await getVideoStatus(tData.page);
        const elapsed = (Date.now() - tData.startTime) / 1000;
        if (elapsed > CONFIG.TIMEOUT_SECONDS && tData.status !== "complete") tData.status = "failed";

        if (tData.status === "complete") {
          await handleCompletedVideo(tData, tIdx, windowIdx);
          activeTabs.delete(tIdx);
        } else if (["failed", "error"].includes(tData.status)) {
          tData.retryCount = (tData.retryCount || 0) + 1;
          if (tData.retryCount < 4) {
            console.log(`\n🔄 [W${windowIdx}-T${tIdx}] Retry ${tData.retryCount}/3...`);
            await closeTabAndCleanup(tData);
            const newData = await setupNewTabWithPrompt(context, { filename: tData.filename, promptIndex: tData.promptIndex, text: tData.promptText }, tIdx, windowIdx, tData.globalIndex, tData.cookieFileName);
            if (newData) { newData.retryCount = tData.retryCount; activeTabs.set(tIdx, newData); } else activeTabs.delete(tIdx);
          } else {
            await handleFailed(tData, tIdx, windowIdx);
            activeTabs.delete(tIdx);
          }
        }
      }

      process.stdout.write(`\r[W${windowIdx}] Tabs: ${activeTabs.size} | Queue: ${getRemainingPrompts()} | ✅${TOTAL_VIDEOS_COMPLETED} ❌${TOTAL_VIDEOS_FAILED}`);

      while (activeTabs.size < CONFIG.MAX_TABS) {
        const next = await getNextPrompt();
        if (!next) { if (activeTabs.size === 0) return; break; }
        let slot = 1; while (activeTabs.has(slot)) slot++;
        try {
          const data = await setupNewTabWithPrompt(context, next.prompt, slot, windowIdx, next.globalIndex, cookieFileName);
          if (data) { activeTabs.set(slot, data); await sleep(1000); }
        } catch (e) { }
      }
      await sleep(CONFIG.POLL_MS);
    }
    await context.close();
  } catch (e) { console.error(`Window ${windowIdx} Error: ${e.message}`); }
}

async function main() {
  let browser = null;
  try {
    SCRIPT_START_TIME = Date.now();
    ensureDownloadDirExists("");
    const allAccounts = loadAllCookieSets();
    const allPrompts = loadAllPromptsFromFiles();

    if (!allPrompts.length) { console.log("No prompts found."); return; }
    if (!allAccounts.length) { console.log("No accounts found."); return; }

    // === INPUTS (BEFORE PROXIES) ===
    getUserConfiguration(allAccounts.length);

    // === LOAD & TEST PROXIES ===
    const allProxies = loadProxies();
    const validProxies = await testProxies(allProxies);

    initializePromptFileTracking(allPrompts);
    GLOBAL_PROMPT_QUEUE = allPrompts;
    GLOBAL_PROMPT_INDEX = 0;

    // === SELECTION ===
    const shuffledAccounts = allAccounts.sort(() => 0.5 - Math.random());
    const selectedAccounts = shuffledAccounts.slice(0, CONFIG.MAX_ACCOUNTS);

    console.log(`\n🎲 Randomly selected ${selectedAccounts.length} unique accounts for this session.`);
    console.log("------------------------------------------------------------");
    selectedAccounts.forEach(a => console.log(`   - ${a.fileName}`));
    console.log("------------------------------------------------------------");

    console.log(`\n🚀 Launching Browser (Stealth + WebRTC Fix)...`);
    browser = await chromium.launch({
      headless: false,
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--webrtc-ip-handling-policy=default_public_interface_only",
        "--force-webrtc-ip-handling-policy"
      ],
    });

    const tasks = selectedAccounts.map((acc, idx) => {
      const proxy = validProxies.length > 0 ? validProxies[idx % validProxies.length] : null;
      return runOneWindow(browser, acc.cookies, idx + 1, acc.fileName, proxy);
    });

    await Promise.all(tasks);

    console.log("\n✅ ALL DONE.");
    console.log(`Stats: ${TOTAL_VIDEOS_COMPLETED} OK | ${TOTAL_VIDEOS_FAILED} Failed`);

  } catch (e) { console.error("FATAL:", e); }
  finally { if (browser) await browser.close(); process.exit(0); }
}

main();