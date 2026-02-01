const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const readlineSync = require('readline-sync');

// ==========================================
// 🛡️ GLOBAL CRASH PREVENTION 🛡️
// ==========================================
process.on('uncaughtException', (err) => {
  console.error(`\n🔥 [CRITICAL SAFETY] Caught unhandled exception: ${err.message}`);
  // Do not exit.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`\n🔥 [CRITICAL SAFETY] Unhandled Rejection: ${reason.message || reason}`);
  // Do not exit.
});

// ==========================================
// USER CONFIGURATION PROMPTS
// ==========================================
console.log('\nSelect Model Preference:');
console.log('  1. Veo 3.1 - Fast (Standard)');
console.log('  2. Veo 3.1 - Fast [Lower Priority] (Zero Credit)');
const modelChoiceInput = readlineSync.questionInt('\nEnter your choice (1 or 2): ');

let modelPreference = '';
if (modelChoiceInput === 2) {
  modelPreference = 'Veo 3.1 - Fast [Lower Priority]';
  console.log('\n▶️ Selected: Veo 3.1 - Fast [Lower Priority] (Zero Credit)\n');
} else {
  modelPreference = 'Veo 3.1 - Fast';
  console.log('\n▶️ Selected: Veo 3.1 - Fast (Standard)\n');
}

const maxTabsInput = readlineSync.questionInt('How many tabs do you want to run in each window? ');
console.log(`\n▶️ Will run ${maxTabsInput} tabs per window.\n`);

console.log('Select Generation Mode:');
console.log('  1. Text to Video');
console.log('  2. Frames to Video');
console.log('  3. Ingredients to Video');
const modeChoice = readlineSync.questionInt('\nEnter your choice (1, 2, or 3): ');

let generationMode = '';
if (modeChoice === 1) {
  generationMode = 'Text to Video';
  console.log('\n▶️ Selected: Text to Video\n');
} else if (modeChoice === 2) {
  generationMode = 'Frames to Video';
  console.log('\n▶️ Selected: Frames to Video\n');
} else if (modeChoice === 3) {
  generationMode = 'Ingredients to Video';
  console.log('\n▶️ Selected: Ingredients to Video\n');
} else {
  console.log('\n⚠️ Invalid choice. Defaulting to Frames to Video\n');
  generationMode = 'Frames to Video';
}

console.log('Select Aspect Ratio:');
console.log('  1. Landscape (16:9)');
console.log('  2. Portrait (9:16)');
const aspectRatioChoice = readlineSync.questionInt('\nEnter your choice (1 or 2): ');

let aspectRatioText = '';
if (aspectRatioChoice === 1) {
  aspectRatioText = 'Landscape (16:9)';
  console.log('\n▶️ Selected: Landscape (16:9)\n');
} else if (aspectRatioChoice === 2) {
  aspectRatioText = 'Portrait (9:16)';
  console.log('\n▶️ Selected: Portrait (9:16)\n');
} else {
  console.log('\n⚠️ Invalid choice. Defaulting to Landscape (16:9)\n');
  aspectRatioText = 'Landscape (16:9)';
}

console.log('File Handling:');
console.log('  1. Overwrite existing videos');
console.log('  2. Skip existing videos (resume mode)');
const overwriteChoice = readlineSync.questionInt('\nEnter your choice (1 or 2): ');

let overwriteMode = true;
if (overwriteChoice === 2) {
  overwriteMode = false;
  console.log('\n▶️ Will skip prompts with existing videos\n');
} else {
  overwriteMode = true;
  console.log('\n▶️ Will overwrite existing videos\n');
}

// --- HARDCODED TIMEOUT (300 Seconds) ---
const timeoutInput = 300;
const timeoutMinutes = Math.floor(timeoutInput / 60);
const timeoutSeconds = timeoutInput % 60;
const timeoutDisplay = timeoutMinutes > 0
  ? `${timeoutMinutes}m ${timeoutSeconds}s`
  : `${timeoutSeconds}s`;
console.log(`\n▶️ Timeout hardcoded to ${timeoutInput} seconds (${timeoutDisplay})\n`);

// ==========================================
// SYSTEM CONFIGURATION
// ==========================================
const CONFIG = {
  // === CRITICAL PATHS ===
  PROFILES_DIR: "d:\\workspace\\flow\\profiles", // DIRECT PROFILES
  PROMPTS_DIR: generationMode === 'Text to Video' ? "d:\\workspace\\flow\\prompts" : "d:\\workspace\\flow\\frames",
  DOWNLOAD_BASE_DIR: "d:\\workspace\\flow\\Videos",
  // ======================

  MAX_TABS: maxTabsInput,
  GENERATION_MODE: generationMode,
  ASPECT_RATIO: aspectRatioText,
  MODEL_PREFERENCE: modelPreference,
  OVERWRITE_MODE: overwriteMode,
  TIMEOUT_SECONDS: timeoutInput,

  POLL_MS: 1000,
  TAB_OPEN_DELAY: 2000,
  DOWNLOAD_TIMEOUT: 60000,
  INTERNET_CHECK_RETRY_DELAY: 30000,
  ACTION_RETRIES: 3,
  ACTION_RETRY_DELAY: 2000,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

  // === RATE LIMIT PROTECTION ===
  MAX_CONSECUTIVE_FAILURES: 5,   // If 5 fails in a row globally...
  COOLDOWN_MINUTES: 60           // ...pause for 60 minutes
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==========================================
// GLOBAL STATE
// ==========================================
let SCRIPT_START_TIME = null;
let GLOBAL_PROMPT_QUEUE = [];
let GLOBAL_PROMPT_INDEX = 0; // Keeping for reference, though unused in new logic
const QUEUE_LOCK = { locked: false };
let TOTAL_VIDEOS_COMPLETED = 0;
let TOTAL_VIDEOS_FAILED = 0;
let TOTAL_VIDEOS_SKIPPED = 0;
let CONSECUTIVE_FAILURES = 0; // New tracker
let IS_COOLDOWN_ACTIVE = false;
const PROMPT_FILE_STATUS = new Map();
let INTERNET_LAST_STATUS = true;

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function formatElapsedTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ==========================================
// GENERIC RETRY WRAPPER
// ==========================================
async function executeWithRetry(fn, description, windowIdx, tabIndex, retries = CONFIG.ACTION_RETRIES) {
  for (let i = 1; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Step failed: "${description}" (Attempt ${i}/${retries})`);
      console.log(`   Error: ${error.message}`);

      if (error.message.includes('Target closed') || error.message.includes('browser has been closed')) {
        throw new Error("BROWSER_CRASHED");
      }

      if (i === retries) {
        console.log(`❌ [Window ${windowIdx}] [Tab ${tabIndex}] Step permanently failed.`);
        throw error;
      }

      console.log(`⏳ [Window ${windowIdx}] [Tab ${tabIndex}] Retrying in ${CONFIG.ACTION_RETRY_DELAY / 1000}s...`);
      await sleep(CONFIG.ACTION_RETRY_DELAY);
      await checkInternetConnection(windowIdx, tabIndex);
    }
  }
}

// ==========================================
// INTERNET CONNECTIVITY
// ==========================================
async function checkInternetConnection(windowIdx = null, tabIndex = null) {
  const prefix = windowIdx && tabIndex ? `[Window ${windowIdx}] [Tab ${tabIndex}]` : '';

  while (true) {
    try {
      const https = require('https');
      await new Promise((resolve, reject) => {
        const req = https.get('https://www.google.com', { timeout: 5000 }, (res) => resolve(true));
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });

      if (!INTERNET_LAST_STATUS) {
        console.log(`\n✅ ${prefix} Internet connection restored. Resuming operations...`);
        INTERNET_LAST_STATUS = true;
      }
      return true;
    } catch (error) {
      if (INTERNET_LAST_STATUS) {
        console.log(`\n⚠️ ${prefix} Internet connection lost!`);
        INTERNET_LAST_STATUS = false;
      }
      console.log(`⏳ ${prefix} Waiting ${CONFIG.INTERNET_CHECK_RETRY_DELAY / 1000} seconds before retry...`);
      await sleep(CONFIG.INTERNET_CHECK_RETRY_DELAY);
      console.log(`🔄 ${prefix} Retrying connection check...`);
    }
  }
}

// ==========================================
// FILE & PROMPT MANAGEMENT
// ==========================================
function initializePromptFileTracking(prompts) {
  const filePromptCounts = new Map();
  prompts.forEach(prompt => {
    const count = filePromptCounts.get(prompt.filename) || 0;
    filePromptCounts.set(prompt.filename, count + 1);
  });

  filePromptCounts.forEach((totalCount, filename) => {
    PROMPT_FILE_STATUS.set(filename, {
      total: totalCount,
      completed: 0,
      failed: 0,
      skipped: 0
    });
  });

  console.log("\n📊 Prompt file tracking initialized:");
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
        console.log(`\n📦 [MOVED] ${filename}.txt -> ${filename}/ folder`);
      }
    } catch (e) {
      console.log(`\n⚠️ Error moving ${filename}.txt: ${e.message}`);
    }
  }
}

function logFailedPromptToFiles(tabData) {
  const globalFailPath = path.join(CONFIG.PROMPTS_DIR, "prompts_fail.txt");
  writePromptFail(globalFailPath, tabData);
}

function writePromptFail(filePath, tabData) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const entry = `Prompt #${tabData.promptIndex} (Profile: ${tabData.profileName}):\n${tabData.promptText}\n\n`;
  try {
    fs.appendFileSync(filePath, entry, "utf8");
  } catch (e) {
    console.log(`⚠️ Could not write to ${filePath}: ${e.message}`);
  }
}

function getDownloadDir(filename) {
  return path.join(CONFIG.DOWNLOAD_BASE_DIR, filename);
}

function ensureDownloadDirExists(filename) {
  const dir = getDownloadDir(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n📁 Created directory: ${dir}`);
  }
  return dir;
}

function checkIfVideoExists(filename, promptIndex) {
  const videoPath = path.join(getDownloadDir(filename), `${promptIndex}.mp4`);
  return fs.existsSync(videoPath);
}

function findImagePath(filename, promptIndex) {
  const base = path.join(CONFIG.PROMPTS_DIR, filename);
  const extensions = ['.png', '.jpg', '.jpeg', '.webp'];

  for (const ext of extensions) {
    const fullPath = path.join(base, `${promptIndex}${ext}`);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function loadAllPromptsFromFiles() {
  console.log(`\n📂 Loading prompts from: ${CONFIG.PROMPTS_DIR}`);

  if (!fs.existsSync(CONFIG.PROMPTS_DIR)) {
    fs.mkdirSync(CONFIG.PROMPTS_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(CONFIG.PROMPTS_DIR)
    .filter((f) => f.endsWith(".txt") && !f.includes("fail") && !f.includes("success"))
    .sort();

  const allPrompts = [];

  for (const file of files) {
    const baseName = path.parse(file).name;
    const filePath = path.join(CONFIG.PROMPTS_DIR, file);
    const content = fs.readFileSync(filePath, "utf8");

    let prompts = [];

    // === NUMBERED LIST DETECTION ===
    const isNumberedList = /^\d+\.\s/m.test(content);

    if (isNumberedList) {
      const lines = content.split(/\r?\n/);
      let currentPrompt = "";

      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.includes('---')) return; // Ignore separator lines

        if (/^\d+\.\s/.test(trimmed)) {
          if (currentPrompt) prompts.push(currentPrompt);
          currentPrompt = trimmed.replace(/^\d+\.\s/, "").trim();
        } else if (trimmed.length > 0 && !trimmed.includes('=======')) {
          currentPrompt += " " + trimmed;
        }
      });
      if (currentPrompt) prompts.push(currentPrompt);
    }
    else {
      // === BLOCK PARAGRAPHS ===
      let blocks = content.split(/\n\s*\n/);
      prompts = blocks.map(p => p.trim())
        .filter(p => p.length > 0 && !p.includes('=======') && !p.includes('---'));

      if (prompts.length === 0 && content.trim().length > 0 && !content.includes('=======') && !content.includes('---')) {
        prompts = [content.trim()];
      }
    }

    prompts.forEach((text, index) => {
      allPrompts.push({
        filename: baseName,
        promptIndex: index + 1,
        text: text,
        globalRetryCount: 0
      });
    });
    console.log(`   ✓ ${file}: ${prompts.length} prompts`);
  }
  console.log(`\n✅ Total: ${allPrompts.length} prompt(s) from ${files.length} file(s)`);
  return allPrompts;
}

// ==========================================
// RATE LIMIT BACKOFF Logic
// ==========================================
async function checkCooldown() {
  if (CONSECUTIVE_FAILURES >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
    if (!IS_COOLDOWN_ACTIVE) {
      IS_COOLDOWN_ACTIVE = true;
      console.log(`\n${"=".repeat(60)}`);
      console.log(`⛔ RATE LIMIT TRIGGERED: ${CONSECUTIVE_FAILURES} consecutive failures!`);
      console.log(`⏸️  Pausing ALL operations for ${CONFIG.COOLDOWN_MINUTES} minutes...`);
      console.log(`${"=".repeat(60)}`);

      let remainingMinutes = CONFIG.COOLDOWN_MINUTES;
      while (remainingMinutes > 0) {
        process.stdout.write(`\r⏳ COOLDOWN: Resuming in ${remainingMinutes} minute(s)...   `);
        await sleep(60000); // Wait 1 minute
        remainingMinutes--;
      }

      console.log(`\n\n✅ Cooldown finished. Resuming operations.`);
      CONSECUTIVE_FAILURES = 0; // Reset counter to give it another try
      IS_COOLDOWN_ACTIVE = false;
    } else {
      // If another thread already triggered it, just wait until it clears
      while (IS_COOLDOWN_ACTIVE) {
        await sleep(5000);
      }
    }
  }
}

async function getNextPrompt(requestingProfileName) {
  while (QUEUE_LOCK.locked) await sleep(10);
  QUEUE_LOCK.locked = true;

  try {
    // Iterate to find the first suitable prompt for this profile
    for (let i = 0; i < GLOBAL_PROMPT_QUEUE.length; i++) {
      const prompt = GLOBAL_PROMPT_QUEUE[i];

      // Check if this profile is banned from this prompt
      if (prompt.failedProfiles && prompt.failedProfiles.includes(requestingProfileName)) {
        continue; // Skip this prompt, let others take it
      }

      // Check conditions (File/Image existence)
      if (!CONFIG.OVERWRITE_MODE && checkIfVideoExists(prompt.filename, prompt.promptIndex)) {
        console.log(`\n⏭️ SKIPPED: ${prompt.filename} #${prompt.promptIndex} (Video exists)`);
        TOTAL_VIDEOS_SKIPPED++;
        const status = PROMPT_FILE_STATUS.get(prompt.filename);
        if (status) { status.skipped++; checkAndMovePromptFile(prompt.filename); }

        // Remove from queue and continue searching
        GLOBAL_PROMPT_QUEUE.splice(i, 1);
        i--;
        continue;
      }

      if (CONFIG.GENERATION_MODE !== 'Text to Video') {
        const imgPath = findImagePath(prompt.filename, prompt.promptIndex);
        if (!imgPath) {
          console.log(`\n🚫 SKIPPED: ${prompt.filename} #${prompt.promptIndex} (Image missing)`);
          TOTAL_VIDEOS_SKIPPED++;
          const status = PROMPT_FILE_STATUS.get(prompt.filename);
          if (status) { status.skipped++; checkAndMovePromptFile(prompt.filename); }

          // Remove from queue and continue searching
          GLOBAL_PROMPT_QUEUE.splice(i, 1);
          i--;
          continue;
        }
        prompt.foundImagePath = imgPath;
      }

      // Found a valid prompt! Remove it from queue and return it.
      const selectedPrompt = GLOBAL_PROMPT_QUEUE.splice(i, 1)[0];
      QUEUE_LOCK.locked = false;

      // We use a timestamp-based ID for tracking since global index is gone
      const trackId = `${selectedPrompt.filename}-${selectedPrompt.promptIndex}`;
      return { prompt: selectedPrompt, globalIndex: trackId };
    }
  } catch (e) {
    console.log(`⚠️ Error in getNextPrompt: ${e.message}`);
  }

  QUEUE_LOCK.locked = false;
  return null;
}

function getRemainingPrompts() {
  return GLOBAL_PROMPT_QUEUE.length - GLOBAL_PROMPT_INDEX;
}

// ==========================================
// PROFILE MANAGEMENT (NEW)
// ==========================================
function loadAllProfiles() {
  console.log("\n👤 Loading profiles...");
  if (!fs.existsSync(CONFIG.PROFILES_DIR)) {
    console.log(`❌ Profile dir not found: ${CONFIG.PROFILES_DIR}`);
    throw new Error(`Profile dir not found`);
  }
  const files = fs.readdirSync(CONFIG.PROFILES_DIR).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`No .json profiles in ${CONFIG.PROFILES_DIR}`);

  const profiles = [];
  for (const file of files) {
    profiles.push({
      name: path.parse(file).name,
      path: path.join(CONFIG.PROFILES_DIR, file)
    });
  }
  console.log(`✅ Loaded ${profiles.length} profiles.`);
  return profiles;
}

// ==========================================
// ROBUST POPUP HANDLER
// ==========================================
async function handlePopup(page) {
  try {
    const popupButtons = [
      page.locator('div[role="dialog"] button:has-text("I agree")').first(),
      page.locator('button:has-text("I agree")').first(),
      page.locator('button:has-text("Agree")').first(),
      page.locator('div[role="alertdialog"] button').last()
    ];

    for (const btn of popupButtons) {
      if (await btn.count() > 0 && await btn.isVisible()) {
        console.log('⚠️ [NOTICE DETECTED] Clicking "I agree"...');
        await btn.click({ force: true });
        await sleep(500);
        return true;
      }
    }
  } catch (e) { }
  return false;
}

// ==========================================
// BROWSER ACTIONS
// ==========================================
async function openNewTab(context, tabIndex, windowIdx) {
  await checkInternetConnection(windowIdx, tabIndex);
  console.log(`\n🌐 [Window ${windowIdx}] [Tab ${tabIndex}] Opening new tab...`);
  const page = await context.newPage();
  // Ensure we are not mobile view if simple resize didn't work, though we use standard launch now.
  return page;
}

async function navigateToFlowHome(page, tabIndex, windowIdx) {
  await checkInternetConnection(windowIdx, tabIndex);
  console.log(`🌐 [Window ${windowIdx}] [Tab ${tabIndex}] Navigating to Flow...`);
  await page.goto("https://labs.google/fx/tools/flow/", { waitUntil: "domcontentloaded", timeout: 60000 });
}

async function clickNewProject(page, tabIndex, windowIdx) {
  await checkInternetConnection(windowIdx, tabIndex);
  await handlePopup(page);

  // Handle "Create with Flow" splash screen if present
  try {
    const splashBtn = page.locator('button:has-text("Create with Flow")');
    if (await splashBtn.count() > 0 && await splashBtn.isVisible()) {
      console.log(`🌐 [Window ${windowIdx}] [Tab ${tabIndex}] Found splash screen, clicking "Create with Flow"...`);
      await splashBtn.click();
      await sleep(2000); // Wait for transition
    }
  } catch (e) {
    console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Splash screen check warning: ${e.message}`);
  }

  console.log(`🌐 [Window ${windowIdx}] [Tab ${tabIndex}] Clicking "New project"...`);
  await page.waitForSelector('button:has-text("New project")', { timeout: 30000 });
  await page.click('button:has-text("New project")');
  await page.waitForURL("**/flow/project/**", { timeout: 60000 });
  console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Project ready`);
}

async function configureProjectSettings(page, tabIndex, windowIdx) {
  try {
    console.log(`🔧 [Window ${windowIdx}] [Tab ${tabIndex}] Configuring settings...`);
    await handlePopup(page);

    const settingsButton = page.locator('button:has(i:text("tune")), [aria-label="Settings"]');
    await settingsButton.waitFor({ state: "visible", timeout: 10000 });
    await settingsButton.click();
    await sleep(1000);

    const popover = page.locator('[role="dialog"], [role="menu"]').last();
    await popover.waitFor({ state: "visible", timeout: 5000 });

    try {
      const modelDropdown = popover.locator('button[role="combobox"]').filter({ has: page.locator('span:has-text("Model")') });
      if (await modelDropdown.count() > 0) {
        await modelDropdown.click({ force: true });
        await sleep(1000);
        const targetOption = page.locator('[role="option"]').filter({ hasText: CONFIG.MODEL_PREFERENCE }).first();
        if (await targetOption.isVisible()) {
          await targetOption.click({ force: true });
          console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Selected Model`);
        }
        await sleep(800);
      }
    } catch (e) { }

    try {
      const aspectRatioButton = popover.locator('button[role="combobox"]').filter({ has: page.locator('span:has-text("Aspect Ratio")') });
      await aspectRatioButton.click({ force: true });
      await sleep(800);
      let targetText = CONFIG.ASPECT_RATIO.includes('Portrait') ? 'Portrait (9:16)' : 'Landscape (16:9)';
      const option = page.locator('[role="option"]').filter({ hasText: targetText }).last();
      await option.click({ force: true });
      await sleep(800);
    } catch (e) { }

    try {
      const dropdownTrigger = popover.locator('button[role="combobox"]').filter({ has: page.locator('span:has-text("Outputs per prompt")') });
      await dropdownTrigger.click({ force: true });
      await sleep(800);
      await page.evaluate(() => {
        const options = document.querySelectorAll('[role="option"]');
        for (const option of options) {
          if (option.querySelector('span') && option.querySelector('span').textContent.trim() === "1") {
            option.click(); return;
          }
        }
      });
      await sleep(800);
    } catch (e) { }

    await settingsButton.click({ force: true });
    await handlePopup(page);
  } catch (e) {
    console.log(`\n⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Settings warning: ${e.message}`);
  }
}

// ========== MAIN SUBMISSION (WITH SAFETY WRAPPER) ==========
async function pasteAndSubmitPrompt(page, rawPromptText, foundImagePath, tabIndex, windowIdx) {
  await checkInternetConnection(windowIdx, tabIndex);

  const imgName = foundImagePath ? path.basename(foundImagePath) : "None";
  console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Mode: ${CONFIG.GENERATION_MODE} (Image: ${imgName})`);

  // --- 1. SWITCH MODE ---
  try {
    await handlePopup(page);

    const modeDropdown = page.locator('button[role="combobox"]').filter({
      has: page.locator('span:text-is("Text to Video"), span:text-is("Ingredients to Video"), span:text-is("Frames to Video")')
    }).first();

    if (await modeDropdown.isVisible()) {
      const currentModeText = await modeDropdown.innerText();

      let targetKeyword = "Frames";
      if (CONFIG.GENERATION_MODE.includes("Text")) targetKeyword = "Text";
      if (CONFIG.GENERATION_MODE.includes("Ingredients")) targetKeyword = "Ingredients";

      if (!currentModeText.includes(targetKeyword)) {
        console.log(`🔀 [Window ${windowIdx}] [Tab ${tabIndex}] Switching to '${CONFIG.GENERATION_MODE}'...`);
        await modeDropdown.click();
        await sleep(1000);
        await handlePopup(page);

        const targetOption = page.locator('[role="option"], [role="menuitem"]').filter({ hasText: targetKeyword });
        if (await targetOption.count() > 0) {
          await targetOption.first().click();
        } else {
          console.log(`⚠️ Option with text "${targetKeyword}" not found!`);
        }
        await sleep(1500);
        await handlePopup(page);
      }
    }
  } catch (e) { console.log(`⚠️ Mode switch warning: ${e.message}`); }

  // --- 2. UPLOAD IMAGE (SAFE) ---
  if (CONFIG.GENERATION_MODE !== 'Text to Video') {
    try {
      console.log(`🖼️ [Window ${windowIdx}] [Tab ${tabIndex}] Uploading image...`);
      await handlePopup(page);

      const addBtn = page.locator('button').filter({ has: page.locator('i.google-symbols:text-is("add")') }).first();

      if (await addBtn.isVisible()) {
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
        await addBtn.click();

        let fileChooser = null;
        try {
          fileChooser = await fileChooserPromise;
        } catch (fcError) {
          console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] File chooser timeout. Trying fallback menu...`);
          await handlePopup(page);
          const uploadBtnInMenu = page.locator('div[role="menu"] button:has-text("Upload")').first();
          if (await uploadBtnInMenu.isVisible()) {
            const menuChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
            await uploadBtnInMenu.click();
            fileChooser = await menuChooserPromise;
          }
        }

        if (fileChooser) {
          await fileChooser.setFiles([foundImagePath]);
          console.log(`📂 [Window ${windowIdx}] [Tab ${tabIndex}] File set: ${path.basename(foundImagePath)}`);
        } else {
          const hiddenInput = page.locator('input[type="file"]').first();
          if (await hiddenInput.count() > 0) {
            await hiddenInput.setInputFiles([foundImagePath]);
          } else {
            throw new Error("Could not find file picker");
          }
        }

        await sleep(2000);
        await handlePopup(page);

        const cropBtn = page.locator('button:has-text("Crop and Save")').first();
        for (let i = 0; i < 10; i++) {
          await handlePopup(page);
          if (await cropBtn.isVisible()) {
            await cropBtn.click();
            console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Clicked 'Crop and Save'`);
            break;
          }
          await sleep(1000);
        }
        await sleep(1000);
      }
    } catch (e) {
      throw new Error(`Upload Failed: ${e.message}`);
    }
  }

  // --- 3. PASTE TEXT & GENERATE ---
  await handlePopup(page);
  console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Pasting prompt...`);
  const inputSelector = 'textarea, input[type="text"], div[contenteditable="true"]';
  const input = await page.waitForSelector(inputSelector, { timeout: 30000 });
  await input.click({ clickCount: 3 });
  await input.press("Backspace");
  await input.fill(rawPromptText);

  await handlePopup(page);
  const btn = page.locator("button:has-text('Generate'), button:has-text('Submit'), button:has-text('Create')").first();
  await btn.waitFor({ state: 'visible', timeout: 30000 });
  await btn.click();

  console.log(`🚀 [Window ${windowIdx}] [Tab ${tabIndex}] Prompt submitted!`);
  await handlePopup(page);
  await sleep(1000);
}

// ========== MONITORING & DOWNLOADING ==========
async function getVideoStatus(page) {
  try {
    return await page.evaluate(() => {
      const card = document.querySelector('[data-index="1"]');
      if (!card) return "pending";

      const downloadBtn = card.querySelector('button i.google-symbols')
        ? Array.from(card.querySelectorAll('button i.google-symbols')).some(el => el.textContent.includes('download'))
        : false;

      if (downloadBtn) return "complete";

      const txt = card.innerText || "";
      if (/failed/i.test(txt)) return "failed";

      const percentMatch = txt.match(/(\d{1,3})%/);
      if (percentMatch) return `${percentMatch[1]}%`;

      if (card.querySelector("video[src]")) return "complete";

      return "pending";
    });
  } catch (e) { return "error"; }
}

async function downloadCompletedVideo(page, tabIndex, windowIdx, filename, promptIndex) {
  try {
    await checkInternetConnection(windowIdx, tabIndex);
    await handlePopup(page);

    if (page.isClosed()) return false;

    console.log(`\n⬇️ [Window ${windowIdx}] [Tab ${tabIndex}] Starting download...`);

    let button = null;
    for (let i = 0; i < 5; i++) {
      const card = await page.waitForSelector('[data-index="1"]', { timeout: 5000 }).catch(() => null);
      if (card) {
        button = await card.$('button:has(i.google-symbols:text("download"))').catch(() => null);
        if (button) break;
      }
      await sleep(1000);
    }

    if (!button) {
      console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Download button not found.`);
      return false;
    }

    const downloadPromise = page.waitForEvent('download', { timeout: CONFIG.DOWNLOAD_TIMEOUT }).catch(() => null);

    await executeWithRetry(async () => {
      await page.evaluate((b) => b.click(), button);
    }, "Click Download", windowIdx, tabIndex, 3);

    await sleep(1000);

    const orig = await page.waitForSelector('div[role="menuitem"]:has-text("Original size (720p)")', { timeout: 5000 }).catch(() => null);
    if (orig) {
      await page.evaluate((b) => b.click(), orig).catch(() => null);
    }

    const download = await downloadPromise;
    if (!download) return false;

    const destDir = ensureDownloadDirExists(filename);
    const downloadPath = path.join(destDir, `${promptIndex}.mp4`);
    await download.saveAs(downloadPath);

    console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Saved: ${filename}/${promptIndex}.mp4`);
    return fs.existsSync(downloadPath);
  } catch (e) {
    return false;
  }
}

// ========== LIFECYCLE MANAGEMENT ==========
function formatStatusLine(activeTabs, windowIdx) {
  const statusParts = [];
  for (const [tabIndex, tabData] of activeTabs) {
    const elapsed = Math.floor((Date.now() - tabData.startTime) / 1000);
    const emoji = tabData.status === "complete" ? "✅" :
      tabData.status === "failed" ? "❌" :
        tabData.status === "error" ? "⚠️" : "⏳";
    statusParts.push(`T${tabIndex}[#${tabData.globalIndex}|${emoji}${tabData.status}|${elapsed}s]`);
  }
  const remaining = getRemainingPrompts();
  const progressBar = `✅${TOTAL_VIDEOS_COMPLETED} ❌${TOTAL_VIDEOS_FAILED} ⏭️${TOTAL_VIDEOS_SKIPPED} ⏳${remaining}`;
  const totalElapsed = formatElapsedTime(Date.now() - SCRIPT_START_TIME);
  return `\n📊 [W${windowIdx}] ${statusParts.join(" | ")} | ${progressBar} | ⏱️ ${totalElapsed}`;
}

async function setupNewTabWithPrompt(context, promptData, tabIndex, windowIdx, globalIndex, profileName) {
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📋 [Window ${windowIdx}] [Tab ${tabIndex}] Setting up GLOBAL prompt #${globalIndex}`);
    console.log(`📋 [Window ${windowIdx}] [Tab ${tabIndex}] Source: ${promptData.filename}, Prompt #${promptData.promptIndex}`);
    if (promptData.globalRetryCount > 0) {
      console.log(`🔄 Retry Attempt: ${promptData.globalRetryCount} (Re-queued from another attempt)`);
    }

    const page = await executeWithRetry(() => openNewTab(context, tabIndex, windowIdx), "Open New Tab", windowIdx, tabIndex);
    await executeWithRetry(() => navigateToFlowHome(page, tabIndex, windowIdx), "Navigate Home", windowIdx, tabIndex);
    await executeWithRetry(() => clickNewProject(page, tabIndex, windowIdx), "Click New Project", windowIdx, tabIndex);
    await executeWithRetry(() => configureProjectSettings(page, tabIndex, windowIdx), "Configure Settings", windowIdx, tabIndex);
    await executeWithRetry(() => pasteAndSubmitPrompt(page, promptData.text, promptData.foundImagePath, tabIndex, windowIdx), "Submit Prompt", windowIdx, tabIndex);

    console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Setup complete & generating...`);
    console.log(`${"=".repeat(60)}`);

    return {
      page,
      promptText: promptData.text,
      filename: promptData.filename,
      promptIndex: promptData.promptIndex,
      globalIndex: globalIndex,
      startTime: Date.now(),
      status: "pending",
      profileName,
      foundImagePath: promptData.foundImagePath,
      globalRetryCount: promptData.globalRetryCount || 0
    };
  } catch (e) {
    console.log(`❌ [Window ${windowIdx}] [Tab ${tabIndex}] Setup failed: ${e.message}`);
    if (context.pages().length > tabIndex) {
      try { context.pages()[tabIndex]?.close(); } catch (ex) { }
    }
    return null;
  }
}

async function closeTabAndCleanup(tabData, tabIndex, windowIdx) {
  try {
    console.log(`\n🔄 [Window ${windowIdx}] [Tab ${tabIndex}] Closing tab...`);
    if (tabData && tabData.page && !tabData.page.isClosed()) {
      await tabData.page.close();
    }
  } catch (e) { }
}

async function runOneWindow(profile, windowIdx) {
  try {
    console.log(`\n🌐 [Window ${windowIdx}] Launching browser for Profile: ${profile.name}...`);

    const browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"]
    });

    // Use stored state for this profile
    const context = await browser.newContext({
      storageState: profile.path,
      viewport: null,
      userAgent: CONFIG.USER_AGENT
    });

    // ⚓ ANCHOR TAB (Prevents browser from closing when all worker tabs cycle)
    const anchorPage = await context.newPage();
    await anchorPage.goto('about:blank');
    console.log(`⚓ [Window ${windowIdx}] Anchor tab opened (keeps window alive).`);

    const activeTabs = new Map();
    let consecutiveProfileFailures = 0; // Local failure tracker

    // INITIAL FILL
    for (let i = 1; i <= CONFIG.MAX_TABS; i++) {
      const next = await getNextPrompt(profile.name);
      if (!next) break;
      const tab = await setupNewTabWithPrompt(context, next.prompt, i, windowIdx, next.globalIndex, profile.name);
      if (tab) activeTabs.set(i, tab);
    }

    // MONITOR LOOP
    while (activeTabs.size > 0 || getRemainingPrompts() > 0) {

      // === PER-PROFILE RATE LIMIT CHECK ===
      if (consecutiveProfileFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`⛔ [Window ${windowIdx}] PROFILE PAUSED: ${profile.name}`);
        console.log(`⚠️ Too many consecutive failures. Cooling down for ${CONFIG.COOLDOWN_MINUTES} mins...`);
        console.log(`${"=".repeat(60)}`);

        await sleep(CONFIG.COOLDOWN_MINUTES * 60 * 1000);

        console.log(`\n✅ [Window ${windowIdx}] Resuming profile: ${profile.name}`);
        consecutiveProfileFailures = 0; // Reset after cooldown
      }

      await checkInternetConnection(windowIdx);

      const tabsToCheck = [...activeTabs.entries()];
      for (const [idx, tab] of tabsToCheck) {
        try {
          if (tab.page && !tab.page.isClosed()) {
            // ... (rest of logic)
            await handlePopup(tab.page);
            tab.status = await getVideoStatus(tab.page);
          } else {
            tab.status = 'error';
          }
        } catch (e) {
          tab.status = 'error';
        }

        const elapsed = (Date.now() - tab.startTime) / 1000;
        if (elapsed > CONFIG.TIMEOUT_SECONDS && tab.status !== 'complete') {
          console.log(`⏰ [Window ${windowIdx}] [Tab ${idx}] TIMEOUT`);
          tab.status = 'failed';
        }

        if (tab.status === 'complete') {
          try {
            // PASS LOCAL COUNTER REF (Simulated by handling return logic or updating external map if needed, 
            // but here we are in same scope if we inline handleCompleted logic or return status)
            // Ideally handleCompletedVideo should return success/fail to update our local counter.
            // Let's modify handleCompletedVideo to return boolean.
            const success = await handleCompletedVideo(tab, idx, windowIdx);
            if (success) consecutiveProfileFailures = 0; // Reset on success
          } catch (e) {
            await closeTabAndCleanup(tab, idx, windowIdx);
          }
          activeTabs.delete(idx);

        } else if (tab.status === 'failed' || tab.status === 'error') {
          console.log(`\n⚠️ [Window ${windowIdx}] [Tab ${idx}] Failed/Error detected.`);
          await closeTabAndCleanup(tab, idx, windowIdx);

          consecutiveProfileFailures++; // Increment local counter

          // RE-QUEUE LOGIC 
          // ... (existing logic)
          const currentGlobalRetries = tab.globalRetryCount || 0;
          if (currentGlobalRetries < 3) {
            reQueuePrompt({
              filename: tab.filename,
              promptIndex: tab.promptIndex,
              promptText: tab.promptText,
              foundImagePath: tab.foundImagePath,
              globalRetryCount: currentGlobalRetries,
              failedProfiles: tab.failedProfiles,
              profileName: profile.name
            }, windowIdx);
          } else {
            console.log(`❌ [Window ${windowIdx}] Max Global Retries exceeded. Faking failure.`);
            await handleFailedVideo(tab, idx, windowIdx);
          }
          activeTabs.delete(idx);
        }
      }

      while (activeTabs.size < CONFIG.MAX_TABS) {
        const next = await getNextPrompt(profile.name);
        if (!next) break;

        let slot = 1;
        while (activeTabs.has(slot)) slot++;

        console.log(`\n🆕 [Window ${windowIdx}] [Tab ${slot}] Loading next prompt...`);
        const tab = await setupNewTabWithPrompt(context, next.prompt, slot, windowIdx, next.globalIndex, profile.name);
        if (tab) activeTabs.set(slot, tab);
      }

      if (activeTabs.size === 0 && getRemainingPrompts() === 0) break;

      process.stdout.write(`\r${formatStatusLine(activeTabs, windowIdx)}`);
      await sleep(CONFIG.POLL_MS);
    }

    await browser.close();
    console.log(`\n✅ [Window ${windowIdx}] Window processing complete.`);
  } catch (error) {
    console.error(`\n❌ [Window ${windowIdx}] CRITICAL WINDOW ERROR: ${error.message}`);
  }
}

async function handleCompletedVideo(tabData, tabIndex, windowIdx) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎉 [Window ${windowIdx}] [Tab ${tabIndex}] VIDEO COMPLETE!`);

  let downloaded = await downloadCompletedVideo(
    tabData.page,
    tabIndex,
    windowIdx,
    tabData.filename,
    tabData.promptIndex
  );

  if (downloaded) {
    TOTAL_VIDEOS_COMPLETED++;
    // Global counter reset removed (handled locally)
    const status = PROMPT_FILE_STATUS.get(tabData.filename);
    if (status) { status.completed++; checkAndMovePromptFile(tabData.filename); }
    await closeTabAndCleanup(tabData, tabIndex, windowIdx); // ✅ Close immediately
    return true; // Success
  } else {
    TOTAL_VIDEOS_FAILED++;
    const status = PROMPT_FILE_STATUS.get(tabData.filename);
    if (status) { status.failed++; checkAndMovePromptFile(tabData.filename); }
    await closeTabAndCleanup(tabData, tabIndex, windowIdx); // ✅ Close immediately
    return false; // Failed download
  }
}

async function handleFailedVideo(tabData, tabIndex, windowIdx) {
  console.log(`\n❌ [Window ${windowIdx}] [Tab ${tabIndex}] GENERATION FAILED (Max Retries)`);
  TOTAL_VIDEOS_FAILED++;
  // Global increment removed (handled locally)
  logFailedPromptToFiles(tabData);
  const status = PROMPT_FILE_STATUS.get(tabData.filename);
  if (status) { status.failed++; checkAndMovePromptFile(tabData.filename); }
  await closeTabAndCleanup(tabData, tabIndex, windowIdx);
}

function reQueuePrompt(tabData, windowIdx) {
  console.log(`🔄 [Window ${windowIdx}] Push prompt back to queue... (Global Retry: ${(tabData.globalRetryCount || 0) + 1}/3)`);

  // Add this profile to the failed list for this prompt
  const failedProfiles = tabData.failedProfiles || [];
  if (!failedProfiles.includes(tabData.profileName)) {
    failedProfiles.push(tabData.profileName);
  }

  GLOBAL_PROMPT_QUEUE.push({
    filename: tabData.filename,
    promptIndex: tabData.promptIndex,
    text: tabData.promptText,
    foundImagePath: tabData.foundImagePath,
    globalRetryCount: (tabData.globalRetryCount || 0) + 1,
    failedProfiles: failedProfiles // Persist the ban list
  });
}

// ==========================================
// MAIN ENTRY POINT
// ==========================================
async function main() {
  try {
    SCRIPT_START_TIME = Date.now();
    console.log("\n" + "=".repeat(60));
    console.log("🔧 VEO VIDEO GENERATOR (PROFILE MODE)");
    console.log("=".repeat(60));

    if (!fs.existsSync(CONFIG.DOWNLOAD_BASE_DIR)) fs.mkdirSync(CONFIG.DOWNLOAD_BASE_DIR, { recursive: true });

    const profiles = loadAllProfiles();
    const prompts = loadAllPromptsFromFiles();

    if (prompts.length === 0) { console.log("⚠️ No prompts found. Exiting."); return; }

    initializePromptFileTracking(prompts);
    GLOBAL_PROMPT_QUEUE = prompts;

    console.log(`\n🚀 Launching ${profiles.length} window(s)...`);

    await Promise.allSettled(profiles.map((p, i) => runOneWindow(p, i + 1)));

    const totalTime = Date.now() - SCRIPT_START_TIME;
    console.log("\n" + "=".repeat(60));
    console.log(`📊 FINAL STATS: ${TOTAL_VIDEOS_COMPLETED} Completed | ${TOTAL_VIDEOS_FAILED} Failed | ${TOTAL_VIDEOS_SKIPPED} Skipped`);
    console.log(`⏱️ Total Time: ${formatElapsedTime(totalTime)}`);
    console.log("=".repeat(60));
    console.log("\n👋 Execution finished.");
  } catch (e) {
    console.error("\n❌ FATAL ERROR:", e);
  }
}

// 🛡️ Global Error Handlers (Prevents Node Process Crash)
process.on('uncaughtException', (err) => {
  console.error(`\n🔥 [CRITICAL] Uncaught Exception: ${err.message}`);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error(`\n🔥 [CRITICAL] Unhandled Rejection: ${reason.message || reason}`);
});

main();