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

// Borderless Mode Removed

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

const isHeadless = false;

const workerCountInput = readlineSync.questionInt('\nHow many concurrent windows (workers) to run? (0 = Run All): ');
const maxWorkers = (workerCountInput <= 0 ? 0 : workerCountInput);
if (maxWorkers > 0) console.log(`\n▶️ Will run up to ${maxWorkers} concurrent windows.\n`);
else console.log(`\n▶️ Will run all profiles simultaneously.\n`);



// ==========================================
// SYSTEM CONFIGURATION
// ==========================================
const BASE_DIR = "d:\\workspace\\flow";
const CONFIG = {
  // === CRITICAL PATHS ===
  PROFILES_DIR: "d:\\workspace\\flow\\profiles", // DIRECT PROFILES
  PROMPTS_DIR: generationMode === 'Frames to Video' ? "d:\\workspace\\flow\\frames" : "d:\\workspace\\flow\\prompts",
  DOWNLOAD_BASE_DIR: "d:\\workspace\\flow\\Videos",
  // ======================

  MAX_TABS: maxTabsInput,
  GENERATION_MODE: generationMode,
  ASPECT_RATIO: aspectRatioText,
  MODEL_PREFERENCE: modelPreference,
  OVERWRITE_MODE: overwriteMode,
  TIMEOUT_SECONDS: timeoutInput,
  HEADLESS: isHeadless,
  MAX_WORKERS: maxWorkers,
  IS_REAL_CHROME: false,
  CHROME_EXE: "",
  CHROME_USER_DATA: "",
  CHROME_PROFILE_DIR: "",
  IS_PARALLEL_REAL: false,
  CHROME_MASTER_DIR: "",
  CHROME_LIST_FILE: "",
  IS_FILE_LIST_MODE: false,

  POLL_MS: 1000,
  TAB_OPEN_DELAY: 2000,
  DOWNLOAD_TIMEOUT: 60000,
  INTERNET_CHECK_RETRY_DELAY: 30000,
  ACTION_RETRIES: 3,
  ACTION_RETRY_DELAY: 2000,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.110 Safari/537.36',

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

function parseImagesFromPrompt(promptText) {
  // Match "image:" or "images:" (singular/plural, case-insensitive)
  // Supports: image:3.jpg,4.jpg,1.jpg  |  images: [file1.png, file2.png]  |  image: file.png
  const match = promptText.match(/^\s*images?:\s*(?:\[([^\]]+)\]|(.+))$/im);
  if (!match) return { cleanText: promptText, imageFiles: [] };

  const raw = (match[1] || match[2]).trim();
  const imageFiles = raw.split(/[,\s]+/).map(f => f.trim()).filter(f => f.length > 0);

  // Remove the image:/images: line from the prompt text
  const cleanText = promptText.replace(/^\s*images?:\s*(?:\[[^\]]*\]|.+)$/im, '').trim();

  return { cleanText, imageFiles };
}

function findImageByName(filename, imageName) {
  const base = path.join(CONFIG.PROMPTS_DIR, filename);
  const fullPath = path.join(base, imageName);
  if (fs.existsSync(fullPath)) return fullPath;

  // Try adding extensions if the name doesn't have one
  const hasExt = /\.[a-zA-Z0-9]+$/.test(imageName);
  if (!hasExt) {
    const extensions = ['.png', '.jpg', '.jpeg', '.webp'];
    for (const ext of extensions) {
      const tryPath = path.join(base, `${imageName}${ext}`);
      if (fs.existsSync(tryPath)) return tryPath;
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

    // === SCENE-BASED DETECTION (Scene 1 —, Scene 2 —, etc.) ===
    const isSceneBased = /^Scene\s+\d+\s*[—–-]/m.test(content);

    if (isSceneBased) {
      // Split by "Scene N —" headers, keeping each full scene as one prompt
      const sceneBlocks = content.split(/(?=^Scene\s+\d+\s*[—–-])/m);
      prompts = sceneBlocks
        .map(block => block.trim())
        .filter(block => block.length > 0 && /^Scene\s+\d+/i.test(block));
      console.log(`   📎 Scene-based format detected: ${prompts.length} scenes`);
    }
    // === NUMBERED LIST DETECTION ===
    else if (/^\d+\.\s/m.test(content)) {
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
      const promptObj = {
        filename: baseName,
        promptIndex: index + 1,
        text: text,
        globalRetryCount: 0
      };

      // For Ingredients mode, parse images: directive from prompt text
      if (CONFIG.GENERATION_MODE === 'Ingredients to Video') {
        const { cleanText, imageFiles } = parseImagesFromPrompt(text);
        if (imageFiles.length > 0) {
          promptObj.text = cleanText;
          promptObj.parsedImageFiles = imageFiles;
          console.log(`      🖼️ Prompt #${index + 1}: images: [${imageFiles.join(', ')}]`);
        }
      }

      allPrompts.push(promptObj);
    });
    console.log(`   ✓ ${file}: ${prompts.length} prompts`);
  }
  console.log(`\n✅ Total: ${allPrompts.length} prompt(s) from ${files.length} file(s)`);
  return allPrompts;
}

// ==========================================
// RATE LIMIT BACKOFF Logic
// ==========================================
// Rate Limit Backoff Logic Removed by User Request
// async function checkCooldown() { ... }

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
        // For Ingredients mode with parsed image files from image: directive
        if (CONFIG.GENERATION_MODE === 'Ingredients to Video') {
          if (prompt.parsedImageFiles && prompt.parsedImageFiles.length > 0) {
            const resolvedPaths = [];
            let missing = false;
            for (const imgFile of prompt.parsedImageFiles) {
              const resolved = findImageByName(prompt.filename, imgFile);
              if (!resolved) {
                console.log(`\n🚫 SKIPPED: ${prompt.filename} #${prompt.promptIndex} (Image missing: ${imgFile})`);
                missing = true;
                break;
              }
              resolvedPaths.push(resolved);
            }
            if (missing) {
              TOTAL_VIDEOS_SKIPPED++;
              const status = PROMPT_FILE_STATUS.get(prompt.filename);
              if (status) { status.skipped++; checkAndMovePromptFile(prompt.filename); }
              GLOBAL_PROMPT_QUEUE.splice(i, 1);
              i--;
              continue;
            }
            prompt.foundImagePaths = resolvedPaths;
            prompt.foundImagePath = resolvedPaths[0]; // backward compat
            prompt.effectiveMode = 'Ingredients to Video';
          } else {
            // No images for this scene — fallback to Text to Video
            console.log(`🔀 [Auto-Fallback] ${prompt.filename} #${prompt.promptIndex}: No images → using Text to Video`);
            prompt.effectiveMode = 'Text to Video';
            prompt.foundImagePaths = [];
            prompt.foundImagePath = null;
          }
        } else {
          // Default: index-based image lookup (Frames to Video)
          const imgPath = findImagePath(prompt.filename, prompt.promptIndex);
          if (!imgPath) {
            console.log(`\n🚫 SKIPPED: ${prompt.filename} #${prompt.promptIndex} (Image missing)`);
            TOTAL_VIDEOS_SKIPPED++;
            const status = PROMPT_FILE_STATUS.get(prompt.filename);
            if (status) { status.skipped++; checkAndMovePromptFile(prompt.filename); }
            GLOBAL_PROMPT_QUEUE.splice(i, 1);
            i--;
            continue;
          }
          prompt.foundImagePath = imgPath;
          prompt.foundImagePaths = [imgPath];
        }
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
    fs.mkdirSync(CONFIG.PROFILES_DIR, { recursive: true });
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

// ========== SWITCH GENERATION MODE ==========
async function switchGenerationMode(page, tabIndex, windowIdx, modeOverride = null) {
  try {
    await handlePopup(page);
    console.log(`🔀 [Window ${windowIdx}] [Tab ${tabIndex}] Looking for mode dropdown...`);

    // Wait for ANY combobox button to appear first (with timeout)
    const anyCombobox = page.locator('button[role="combobox"]').first();
    await anyCombobox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

    // Now try to find the mode-specific dropdown
    // Include "Create Image" since that's the default mode on new projects
    const modeDropdown = page.locator('button[role="combobox"]').filter({
      has: page.locator('span:text-is("Text to Video"), span:text-is("Ingredients to Video"), span:text-is("Frames to Video"), span:text-is("Create Image")')
    }).first();

    let modeVisible = false;
    try {
      await modeDropdown.waitFor({ state: 'visible', timeout: 5000 });
      modeVisible = true;
    } catch (e) {
      console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Mode dropdown not found with exact text match, trying broader search...`);
      const allComboboxes = await page.locator('button[role="combobox"]').all();
      for (const cb of allComboboxes) {
        const text = await cb.innerText().catch(() => '');
        console.log(`   🔍 Combobox text: "${text}"`);
        // If we find a combobox with image/video mode text, use it
        if (/image|video|text|ingredient|frame/i.test(text)) {
          modeVisible = true;
          break;
        }
      }
    }

    if (modeVisible) {
      const currentModeText = await modeDropdown.innerText();
      console.log(`🔍 [Window ${windowIdx}] [Tab ${tabIndex}] Current mode: "${currentModeText}"`);

      const effectiveMode = modeOverride || CONFIG.GENERATION_MODE;
      let targetKeyword = "Frames";
      if (effectiveMode.includes("Text")) targetKeyword = "Text";
      if (effectiveMode.includes("Ingredients")) targetKeyword = "Ingredients";

      if (!currentModeText.includes(targetKeyword)) {
        console.log(`🔀 [Window ${windowIdx}] [Tab ${tabIndex}] Switching from "${currentModeText.trim()}" to '${effectiveMode}'...`);
        await modeDropdown.click({ timeout: 5000 });
        await sleep(1500);
        await handlePopup(page);

        // Log all visible options for debugging
        const allOptions = await page.evaluate(() => {
          const opts = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listbox"] *');
          return Array.from(opts).map(o => ({
            text: o.textContent.trim().substring(0, 100),
            role: o.getAttribute('role'),
            tag: o.tagName
          }));
        });
        console.log(`🔍 [Window ${windowIdx}] [Tab ${tabIndex}] Dropdown options found:`);
        allOptions.forEach((o, i) => console.log(`   [${i}] <${o.tag} role="${o.role}"> "${o.text}"`));

        let optionClicked = false;

        // Approach 1: Playwright locator with case-insensitive matching
        try {
          const targetOption = page.locator('[role="option"], [role="menuitem"]').filter({ hasText: new RegExp(targetKeyword, 'i') });
          await targetOption.first().waitFor({ state: 'visible', timeout: 5000 });
          await targetOption.first().click({ timeout: 5000 });
          optionClicked = true;
          console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Selected: ${targetKeyword}`);
        } catch (optErr) {
          console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Locator approach failed, trying evaluate...`);
        }

        // Approach 2: page.evaluate with case-insensitive match
        if (!optionClicked) {
          optionClicked = await page.evaluate((keyword) => {
            const lowerKeyword = keyword.toLowerCase();
            const options = document.querySelectorAll('[role="option"], [role="menuitem"]');
            for (const opt of options) {
              if (opt.textContent.toLowerCase().includes(lowerKeyword)) {
                opt.click();
                return true;
              }
            }
            const anyClickable = document.querySelectorAll('[role="listbox"] *, [role="menu"] *, [data-value]');
            for (const el of anyClickable) {
              if (el.textContent.toLowerCase().includes(lowerKeyword) && (el.tagName === 'BUTTON' || el.tagName === 'DIV' || el.tagName === 'LI' || el.getAttribute('role'))) {
                el.click();
                return true;
              }
            }
            return false;
          }, targetKeyword);
          if (optionClicked) console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Selected via evaluate: ${targetKeyword}`);
          else console.log(`❌ [Window ${windowIdx}] [Tab ${tabIndex}] Could not find option "${targetKeyword}" in dropdown`);
        }

        await sleep(2000);
        await handlePopup(page);

        // If dropdown is still open, press Escape to close it
        await page.keyboard.press('Escape').catch(() => { });
        await sleep(500);
      } else {
        console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Already in correct mode: ${targetKeyword}`);
      }
    }
  } catch (e) { console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Mode switch warning: ${e.message}`); }
}

// ========== MAIN SUBMISSION (WITH SAFETY WRAPPER) ==========
async function pasteAndSubmitPrompt(page, rawPromptText, foundImagePath, tabIndex, windowIdx, foundImagePaths = null) {
  await checkInternetConnection(windowIdx, tabIndex);

  // Normalize to array of image paths
  const imagePaths = foundImagePaths || (foundImagePath ? [foundImagePath] : []);
  const imgNames = imagePaths.length > 0 ? imagePaths.map(p => path.basename(p)).join(', ') : "None";
  console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Mode: ${CONFIG.GENERATION_MODE} (Images: ${imgNames})`);

  // NOTE: Mode switching is now done earlier in setupNewTabWithPrompt (before configureProjectSettings)

  // --- 2. UPLOAD IMAGE(S) (SAFE) ---
  if (CONFIG.GENERATION_MODE !== 'Text to Video' && imagePaths.length > 0) {
    console.log(`🔍 [DEBUG] imagePaths array (${imagePaths.length} images):`);
    imagePaths.forEach((p, i) => console.log(`   [${i}]: ${p}`));

    for (let imgIdx = 0; imgIdx < imagePaths.length; imgIdx++) {
      const currentImagePath = imagePaths[imgIdx];
      try {
        console.log(`🖼️ [Window ${windowIdx}] [Tab ${tabIndex}] Uploading image ${imgIdx + 1}/${imagePaths.length}: ${currentImagePath}`);
        await handlePopup(page);

        // For 2nd+ images: wait for the previous image thumbnail to fully render
        if (imgIdx > 0) {
          console.log(`⏳ [Window ${windowIdx}] [Tab ${tabIndex}] Waiting for previous image to fully process...`);
          // Wait for the number of uploaded image thumbnails to match imgIdx
          for (let waitAttempt = 0; waitAttempt < 15; waitAttempt++) {
            const thumbnailCount = await page.locator('img[src*="blob:"], img[src*="data:"], img[src*="googleusercontent"]').count();
            if (thumbnailCount >= imgIdx) break;
            await sleep(1000);
          }
          await sleep(1000);

          // Dismiss any lingering menus or dialogs
          await page.keyboard.press('Escape').catch(() => { });
          await sleep(500);
          await handlePopup(page);
        }

        // Remove old file inputs to force the app to create fresh ones
        await page.evaluate(() => {
          document.querySelectorAll('input[type="file"]').forEach(input => {
            try { input.value = ''; } catch (e) { }
          });
        });
        await sleep(500);

        // Find and click the add button
        const addBtn = page.locator('button').filter({ has: page.locator('i.google-symbols:text-is("add")') }).last();
        await addBtn.waitFor({ state: 'visible', timeout: 15000 });
        await sleep(500);

        // Intercept file chooser BEFORE clicking
        const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
        await addBtn.click();

        let fileChooser = null;
        try {
          fileChooser = await fileChooserPromise;
        } catch (fcError) {
          console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] File chooser timeout for image ${imgIdx + 1}. Trying fallback menu...`);
          await handlePopup(page);
          // The add button may have opened a menu instead of file chooser
          const uploadBtnInMenu = page.locator('[role="menu"] button:has-text("Upload"), [role="menu"] [role="menuitem"]:has-text("Upload"), [role="listbox"] [role="option"]:has-text("Upload")').first();
          if (await uploadBtnInMenu.isVisible()) {
            const menuChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
            await uploadBtnInMenu.click();
            fileChooser = await menuChooserPromise;
          } else {
            // Try clicking upload button directly as last resort 
            console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Menu upload button not found, looking for any upload option...`);
            const anyUploadBtn = page.locator('button:has-text("Upload"), [role="menuitem"]:has-text("Upload")').first();
            if (await anyUploadBtn.count() > 0 && await anyUploadBtn.isVisible()) {
              const anyChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
              await anyUploadBtn.click();
              fileChooser = await anyChooserPromise;
            }
          }
        }

        if (fileChooser) {
          console.log(`🔍 [DEBUG] Setting file on chooser for image ${imgIdx + 1}: ${currentImagePath}`);
          await fileChooser.setFiles([currentImagePath]);
          console.log(`📂 [Window ${windowIdx}] [Tab ${tabIndex}] File set: ${path.basename(currentImagePath)}`);
        } else {
          // Fallback: directly set on the newest file input
          console.log(`📎 [Window ${windowIdx}] [Tab ${tabIndex}] Using hidden input fallback for image ${imgIdx + 1}...`);
          const fileInputs = page.locator('input[type="file"]');
          const inputCount = await fileInputs.count();
          if (inputCount > 0) {
            const targetInput = fileInputs.nth(inputCount - 1);
            await targetInput.setInputFiles([currentImagePath]);
            console.log(`📂 [Window ${windowIdx}] [Tab ${tabIndex}] File set via input: ${path.basename(currentImagePath)}`);
          } else {
            throw new Error(`Could not find file picker for image ${imgIdx + 1}`);
          }
        }

        // Wait for crop editor to load the image
        await sleep(3000);
        await handlePopup(page);

        const cropBtn = page.locator('button:has-text("Crop and Save")').first();
        let cropClicked = false;
        for (let i = 0; i < 15; i++) {
          await handlePopup(page);
          if (await cropBtn.isVisible()) {
            await cropBtn.click();
            console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Clicked 'Crop and Save' for image ${imgIdx + 1}`);
            cropClicked = true;
            break;
          }
          await sleep(1000);
        }
        if (!cropClicked) {
          console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Crop button never appeared for image ${imgIdx + 1}, continuing...`);
        }

        // Wait for crop dialog to fully close before next upload
        if (imgIdx < imagePaths.length - 1) {
          console.log(`⏳ [Window ${windowIdx}] [Tab ${tabIndex}] Waiting for crop dialog to close for image ${imgIdx + 1}...`);
          await page.locator('button:has-text("Crop and Save")').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => { });
          await sleep(3000);
          await handlePopup(page);

          // Wait for this ingredient to fully appear (button with "close" icon = processed ingredient)
          console.log(`⏳ [Window ${windowIdx}] [Tab ${tabIndex}] Waiting for ingredient ${imgIdx + 1} to register...`);
          const expectedIngredients = imgIdx + 1;
          for (let waitAttempt = 0; waitAttempt < 20; waitAttempt++) {
            const ingredientCount = await page.locator('button:has(i.google-symbols:text-is("close"))').count();
            if (ingredientCount >= expectedIngredients) {
              console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] ${ingredientCount} ingredient(s) confirmed`);
              break;
            }
            await sleep(1000);
          }
          await sleep(1000);
        } else {
          // Last image: wait for crop to close + ingredient to register
          await page.locator('button:has-text("Crop and Save")').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => { });
          await sleep(2000);
        }
      } catch (e) {
        throw new Error(`Upload Failed (image ${imgIdx + 1}: ${path.basename(currentImagePath)}): ${e.message}`);
      }
    }

    // --- VERIFY ALL INGREDIENTS ARE PRESENT BEFORE SUBMITTING ---
    console.log(`🔍 [Window ${windowIdx}] [Tab ${tabIndex}] Verifying all ${imagePaths.length} ingredients are present...`);
    let allIngredientsReady = false;
    for (let verifyAttempt = 0; verifyAttempt < 30; verifyAttempt++) {
      await handlePopup(page);
      const ingredientCount = await page.locator('button:has(i.google-symbols:text-is("close"))').count();
      if (ingredientCount >= imagePaths.length) {
        console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] All ${ingredientCount}/${imagePaths.length} ingredients confirmed!`);
        allIngredientsReady = true;
        break;
      }
      console.log(`⏳ [Window ${windowIdx}] [Tab ${tabIndex}] Only ${ingredientCount}/${imagePaths.length} ingredients ready, waiting...`);
      await sleep(2000);
    }
    if (!allIngredientsReady) {
      const finalCount = await page.locator('button:has(i.google-symbols:text-is("close"))').count();
      console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Warning: Only ${finalCount}/${imagePaths.length} ingredients detected after waiting. Proceeding anyway...`);
    }
    await sleep(1000);
  }

  // --- 3. PASTE TEXT & GENERATE ---
  await handlePopup(page);
  await sleep(1500);
  console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Pasting prompt text...`);

  // Click "Expand" if visible to get the full text input area
  try {
    const expandBtn = page.locator('button:has-text("Expand")').first();
    if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expandBtn.click({ timeout: 3000 });
      console.log(`📐 [Window ${windowIdx}] [Tab ${tabIndex}] Clicked Expand to open full input`);
      await sleep(1500);
      await handlePopup(page);
    }
  } catch (e) { }

  // Debug: Log all input-like elements
  const inputDebug = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('div[contenteditable="true"]').forEach((el, i) => {
      result.push({ type: 'contenteditable', i, text: el.textContent.substring(0, 80), placeholder: el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '' });
    });
    document.querySelectorAll('textarea').forEach((el, i) => {
      result.push({ type: 'textarea', i, placeholder: el.placeholder || '', value: el.value.substring(0, 80) });
    });
    document.querySelectorAll('input[type="text"]').forEach((el, i) => {
      result.push({ type: 'input', i, placeholder: el.placeholder || '', value: el.value.substring(0, 80) });
    });
    return result;
  });
  console.log(`🔍 [Window ${windowIdx}] [Tab ${tabIndex}] Input elements found: ${inputDebug.length}`);
  inputDebug.forEach((el, i) => console.log(`   [${i}] ${el.type} placeholder="${el.placeholder}" text="${el.text || el.value || ''}"`));

  let inputFilled = false;

  // Approach 1: Use Playwright's fill() — works for textarea/input and triggers framework events properly
  try {
    const promptInput = page.locator('div[contenteditable="true"], textarea, input[type="text"]').first();
    await promptInput.waitFor({ state: 'visible', timeout: 10000 });
    await promptInput.click({ timeout: 5000 });
    await sleep(500);
    await promptInput.fill(rawPromptText, { timeout: 5000 });
    inputFilled = true;
    console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Prompt filled via fill()`);
  } catch (e) {
    console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] fill() failed: ${e.message}`);
  }

  // Approach 2: Click input and type via keyboard (most reliable for contenteditable)
  if (!inputFilled) {
    try {
      console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Trying click+keyboard type...`);
      const promptInput = page.locator('div[contenteditable="true"], textarea').first();
      await promptInput.click({ timeout: 5000 });
      await sleep(500);
      await page.keyboard.press('Control+a');
      await sleep(200);
      await page.keyboard.press('Backspace');
      await sleep(200);
      await page.keyboard.type(rawPromptText, { delay: 5 });
      inputFilled = true;
      console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Prompt typed via keyboard`);
    } catch (e) {
      console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Keyboard type failed: ${e.message}`);
    }
  }

  // Approach 3: Click on visible placeholder text, then type
  if (!inputFilled) {
    try {
      console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Trying placeholder click+type...`);
      let clicked = false;
      for (const placeholderText of ['Generate a video with text and ingredients', 'Describe a video', 'Generate a video', 'Type in the prompt box']) {
        const el = page.locator(`text="${placeholderText}"`).first();
        if (await el.count() > 0) {
          await el.click({ timeout: 3000 });
          clicked = true;
          console.log(`   Clicked on placeholder: "${placeholderText}"`);
          break;
        }
      }
      if (clicked) {
        await sleep(500);
        await page.keyboard.press('Control+a');
        await sleep(200);
        await page.keyboard.press('Backspace');
        await sleep(200);
        await page.keyboard.type(rawPromptText, { delay: 5 });
        inputFilled = true;
        console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Prompt typed after placeholder click`);
      }
    } catch (e) {
      console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabIndex}] Placeholder click+type failed: ${e.message}`);
    }
  }

  // Approach 4: Last resort — page.evaluate to set text directly
  if (!inputFilled) {
    try {
      console.log(`📝 [Window ${windowIdx}] [Tab ${tabIndex}] Trying evaluate approach...`);
      await page.evaluate((text) => {
        const editables = document.querySelectorAll('div[contenteditable="true"]');
        for (const el of editables) {
          el.focus();
          el.textContent = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          // Also try InputEvent for React-like frameworks
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          return;
        }
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(ta, text);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }, rawPromptText);
      inputFilled = true;
      console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Prompt set via evaluate()`);
    } catch (e) {
      console.log(`❌ [Window ${windowIdx}] [Tab ${tabIndex}] All input approaches failed: ${e.message}`);
    }
  }

  if (!inputFilled) {
    console.log(`❌ [Window ${windowIdx}] [Tab ${tabIndex}] FAILED to paste prompt text!`);
  }

  await sleep(1000);
  await handlePopup(page);

  // --- SUBMIT ---
  console.log(`🚀 [Window ${windowIdx}] [Tab ${tabIndex}] Looking for submit button...`);

  // Debug: log last buttons on the page
  const buttonDebug = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).slice(-10).map(btn => ({
      text: btn.textContent.trim().substring(0, 50),
      ariaLabel: btn.getAttribute('aria-label') || '',
      disabled: btn.disabled,
      visible: btn.offsetParent !== null,
      iconText: btn.querySelector('i') ? btn.querySelector('i').textContent.trim() : ''
    }));
  });
  console.log(`� [Window ${windowIdx}] [Tab ${tabIndex}] Last 10 buttons:`);
  buttonDebug.forEach((b, i) => console.log(`   [${i}] "${b.text}" icon="${b.iconText}" aria="${b.ariaLabel}" disabled=${b.disabled} visible=${b.visible}`));

  let submitted = false;

  // Try arrow_forward button first (the → icon visible in screenshots)
  try {
    const arrowBtn = page.locator('button:has(i.google-symbols:text-is("arrow_forward"))').first();
    if (await arrowBtn.count() > 0 && await arrowBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await arrowBtn.click({ timeout: 5000 });
      submitted = true;
      console.log(`🚀 [Window ${windowIdx}] [Tab ${tabIndex}] Submitted via arrow_forward button`);
    }
  } catch (e) { }

  // Try Enter key
  if (!submitted) {
    try {
      await page.keyboard.press('Enter');
      await sleep(2000);
      const hasCard = await page.locator('[data-index="1"]').count();
      if (hasCard > 0) {
        submitted = true;
        console.log(`🚀 [Window ${windowIdx}] [Tab ${tabIndex}] Submitted via Enter key`);
      }
    } catch (e) { }
  }

  // Try text-based Generate/Submit button
  if (!submitted) {
    try {
      const textBtn = page.locator("button:has-text('Generate'), button:has-text('Submit'), button:has-text('Create')").first();
      if (await textBtn.count() > 0 && await textBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await textBtn.click({ timeout: 5000 });
        submitted = true;
        console.log(`🚀 [Window ${windowIdx}] [Tab ${tabIndex}] Submitted via text button`);
      }
    } catch (e) { }
  }

  // Last resort: evaluate to find and click any submit button
  if (!submitted) {
    try {
      submitted = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const iconText = btn.querySelector('i') ? btn.querySelector('i').textContent.trim().toLowerCase() : '';
          const text = (btn.textContent || '').toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          if ((iconText === 'arrow_forward' || iconText === 'send' ||
            text.includes('generate') || text.includes('submit') || text.includes('send') ||
            ariaLabel.includes('generate') || ariaLabel.includes('submit') || ariaLabel.includes('send')) &&
            btn.offsetParent !== null && !btn.disabled) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      if (submitted) console.log(`🚀 [Window ${windowIdx}] [Tab ${tabIndex}] Submitted via evaluate`);
      else console.log(`❌ [Window ${windowIdx}] [Tab ${tabIndex}] Could not find submit button!`);
    } catch (e) { }
  }

  console.log(`${submitted ? '🚀' : '❌'} [Window ${windowIdx}] [Tab ${tabIndex}] Prompt ${submitted ? 'submitted!' : 'submission failed!'}`);
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
      if (percentMatch) return "generating"; // [Changed] Return normalized status for timeout logic

      if (card.querySelector("video[src]")) return "complete";

      // If we have a card but no explicit status, assume generating/preparing
      return "generating";

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
    // Use per-scene effective mode (falls back to Text to Video for imageless Ingredients scenes)
    const effectiveMode = promptData.effectiveMode || CONFIG.GENERATION_MODE;
    if (effectiveMode !== CONFIG.GENERATION_MODE) {
      console.log(`🔀 [Window ${windowIdx}] [Tab ${tabIndex}] Scene override: using '${effectiveMode}' instead of '${CONFIG.GENERATION_MODE}'`);
    }
    await executeWithRetry(() => switchGenerationMode(page, tabIndex, windowIdx, effectiveMode), "Switch Mode", windowIdx, tabIndex);
    await executeWithRetry(() => configureProjectSettings(page, tabIndex, windowIdx), "Configure Settings", windowIdx, tabIndex);
    await executeWithRetry(() => pasteAndSubmitPrompt(page, promptData.text, promptData.foundImagePath, tabIndex, windowIdx, promptData.foundImagePaths), "Submit Prompt", windowIdx, tabIndex);

    console.log(`✅ [Window ${windowIdx}] [Tab ${tabIndex}] Setup complete & generating...`);
    console.log(`${"=".repeat(60)}`);

    return {
      page,
      promptText: promptData.text,
      filename: promptData.filename,
      promptIndex: promptData.promptIndex,
      globalIndex: globalIndex,
      startTime: Date.now(),
      lastProgressTime: Date.now(), // [New] Track progress for smart timeout
      status: "pending",
      profileName,
      foundImagePath: promptData.foundImagePath,
      foundImagePaths: promptData.foundImagePaths,
      parsedImageFiles: promptData.parsedImageFiles,
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

    let browser, context;

    const launchArgs = [];
    launchArgs.push("--start-maximized");

    browser = await chromium.launch({
      headless: CONFIG.HEADLESS,
      args: launchArgs
    });

    // Use stored state for this profile
    context = await browser.newContext({
      storageState: profile.path,
      viewport: null,
      userAgent: CONFIG.USER_AGENT
    });

    // ⚓ ANCHOR TAB (Prevents browser from closing when all worker tabs cycle)
    const anchorPage = await context.newPage();
    await anchorPage.goto('about:blank');
    console.log(`⚓ [Window ${windowIdx}] Anchor tab opened (keeps window alive).`);

    // Shared state for status display
    const activeTabs = new Map();

    // Status display interval
    const statusInterval = setInterval(() => {
      if (activeTabs.size > 0) {
        process.stdout.write(`\r${formatStatusLine(activeTabs, windowIdx)}`);
      }
    }, CONFIG.POLL_MS);

    // ==========================================
    // PER-TAB INDEPENDENT WORKER
    // ==========================================
    async function tabWorker(tabSlot) {
      console.log(`🔧 [Window ${windowIdx}] [Tab ${tabSlot}] Worker started`);

      while (true) {
        // --- 1. GRAB NEXT PROMPT ---
        await checkInternetConnection(windowIdx, tabSlot);
        const next = await getNextPrompt(profile.name);
        if (!next) {
          console.log(`📭 [Window ${windowIdx}] [Tab ${tabSlot}] No more prompts. Worker exiting.`);
          break;
        }

        // --- 2. SETUP TAB (open, navigate, configure, submit) ---
        console.log(`\n🆕 [Window ${windowIdx}] [Tab ${tabSlot}] Loading prompt: ${next.prompt.filename} #${next.prompt.promptIndex}`);
        const tab = await setupNewTabWithPrompt(context, next.prompt, tabSlot, windowIdx, next.globalIndex, profile.name);

        if (!tab) {
          console.log(`❌ [Window ${windowIdx}] [Tab ${tabSlot}] Setup failed, re-queuing...`);
          const retries = next.prompt.globalRetryCount || 0;
          if (retries < 3) {
            reQueuePrompt({
              filename: next.prompt.filename,
              promptIndex: next.prompt.promptIndex,
              promptText: next.prompt.text,
              foundImagePath: next.prompt.foundImagePath,
              foundImagePaths: next.prompt.foundImagePaths,
              parsedImageFiles: next.prompt.parsedImageFiles,
              globalRetryCount: retries,
              failedProfiles: next.prompt.failedProfiles,
              profileName: profile.name
            }, windowIdx);
          }
          await sleep(2000);
          continue;
        }

        // Register in shared map for status display
        activeTabs.set(tabSlot, tab);

        // --- 3. MONITOR UNTIL DONE ---
        let finalStatus = 'pending';
        while (true) {
          await sleep(CONFIG.POLL_MS);

          try {
            await checkInternetConnection(windowIdx, tabSlot);

            if (tab.page && !tab.page.isClosed()) {
              await handlePopup(tab.page);
              tab.status = await getVideoStatus(tab.page);
            } else {
              tab.status = 'error';
            }
          } catch (e) {
            tab.status = 'error';
          }

          // Smart timeout: reset clock on progress
          if (tab.status !== 'error' && tab.status !== 'failed') {
            if (tab.status === 'generating' || tab.status === 'complete') {
              tab.lastProgressTime = Date.now();
            }
          }

          const timeSinceProgress = (Date.now() - (tab.lastProgressTime || tab.startTime)) / 1000;
          const dynamicTimeout = (tab.status === 'generating') ? (CONFIG.TIMEOUT_SECONDS * 2) : CONFIG.TIMEOUT_SECONDS;

          if (timeSinceProgress > dynamicTimeout && tab.status !== 'complete') {
            console.log(`⏰ [Window ${windowIdx}] [Tab ${tabSlot}] TIMEOUT (Stuck for ${Math.round(timeSinceProgress)}s)`);
            tab.status = 'failed';
          }

          // Check terminal states
          if (tab.status === 'complete' || tab.status === 'failed' || tab.status === 'error') {
            finalStatus = tab.status;
            break;
          }
        }

        // --- 4. HANDLE RESULT ---
        if (finalStatus === 'complete') {
          try {
            await handleCompletedVideo(tab, tabSlot, windowIdx);
          } catch (e) {
            console.log(`⚠️ [Window ${windowIdx}] [Tab ${tabSlot}] Download error: ${e.message}`);
            await closeTabAndCleanup(tab, tabSlot, windowIdx);
          }
        } else {
          // Failed or error
          console.log(`\n⚠️ [Window ${windowIdx}] [Tab ${tabSlot}] ${finalStatus.toUpperCase()} detected.`);
          await closeTabAndCleanup(tab, tabSlot, windowIdx);

          // Re-queue with retry limit
          const currentGlobalRetries = tab.globalRetryCount || 0;
          if (currentGlobalRetries < 3) {
            reQueuePrompt({
              filename: tab.filename,
              promptIndex: tab.promptIndex,
              promptText: tab.promptText,
              foundImagePath: tab.foundImagePath,
              foundImagePaths: tab.foundImagePaths,
              parsedImageFiles: tab.parsedImageFiles,
              globalRetryCount: currentGlobalRetries,
              failedProfiles: tab.failedProfiles,
              profileName: profile.name
            }, windowIdx);
          }
        }

        // Remove from status display
        activeTabs.delete(tabSlot);
      }

      console.log(`� [Window ${windowIdx}] [Tab ${tabSlot}] Worker finished`);
    }

    // ==========================================
    // SPAWN ALL TAB WORKERS IN PARALLEL
    // ==========================================
    const tabWorkers = [];
    for (let i = 1; i <= CONFIG.MAX_TABS; i++) {
      tabWorkers.push(tabWorker(i));
    }
    await Promise.all(tabWorkers);

    clearInterval(statusInterval);
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

    // --- PERIODIC CLEANUP (Every 2 Videos) ---
    if (TOTAL_VIDEOS_COMPLETED > 0 && TOTAL_VIDEOS_COMPLETED % 2 === 0) {
      await cleanSiteData(tabData.page);
    }
    // -----------------------------------------
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
    foundImagePaths: tabData.foundImagePaths,
    parsedImageFiles: tabData.parsedImageFiles,
    globalRetryCount: (tabData.globalRetryCount || 0) + 1,
    failedProfiles: failedProfiles // Persist the ban list
  });
}

async function cleanSiteData(page) {
  try {
    console.log("   🧹 [Periodic Cleanup] Clearing Site Data (Cookies Preserved)...");
    const client = await page.context().newCDPSession(page);
    // Clearing 'cookies' here would log the user out, so we exclude it based on previous request.
    await client.send('Storage.clearDataForOrigin', {
      origin: page.url(),
      storageTypes: 'appcache,cache_storage,file_systems,indexeddb,local_storage,shader_cache,websql,service_workers'
    });
  } catch (e) {
    console.log(`   ⚠️ Cleanup Failed: ${e.message}`);
  }
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

    const prompts = loadAllPromptsFromFiles();

    if (prompts.length === 0) { console.log("⚠️ No prompts found. Exiting."); return; }

    initializePromptFileTracking(prompts);
    GLOBAL_PROMPT_QUEUE = prompts;

    // === PROFILE LOADING ===
    let profiles = [];
    // Load Bundled Profiles directly
    profiles = fs.readdirSync(CONFIG.PROFILES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: path.parse(f).name,
        path: path.join(CONFIG.PROFILES_DIR, f)
      }));

    console.log(`\n🚀 Launching... (Active Profiles: ${profiles.length})`);

    // === WORKER POOL LOGIC ===
    const maxConcurrency = CONFIG.MAX_WORKERS > 0 ? CONFIG.MAX_WORKERS : profiles.length;
    const profileQueue = [...profiles];

    // Worker function: keeps picking profiles until queue is empty
    async function worker(workerId) {
      while (profileQueue.length > 0) {
        // Pick next profile (Thread-safe-ish since JS is single threaded event loop)
        const profile = profileQueue.shift();
        if (!profile) break;

        console.log(`\n👷 [Worker ${workerId}] Starting Profile: ${profile.name}`);
        try {
          // runOneWindow now acts as a "task" for the worker
          await runOneWindow(profile, workerId);
        } catch (e) {
          console.error(`❌ [Worker ${workerId}] Error in profile ${profile.name}: ${e.message}`);
        }
        console.log(`✅ [Worker ${workerId}] Finished Profile: ${profile.name}`);
      }
    }



    // --- START WORKERS ---
    const workers = [];
    const actualWorkers = Math.min(maxConcurrency, profiles.length);
    for (let i = 1; i <= actualWorkers; i++) {
      workers.push(worker(i));
    }

    await Promise.allSettled(workers);

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