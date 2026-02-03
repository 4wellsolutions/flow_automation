const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const readlineSync = require('readline-sync');
const PromptManager = require('./utils/prompt_manager');

// [Deleted Helpers: copyRecursiveSync, prepareIsolatedProfile, cleanupTempProfiles]

// [New] Auth Harvesting Logic
async function forceKillChrome() {
    try {
        console.log("   🔪 Ensuring no stuck Chrome processes...");
        require('child_process').execSync('taskkill /F /IM chrome.exe', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 1000));
    } catch (e) { /* ignore if not found */ }
}

async function ensureAuthCache(profiles) {
    console.log("   (This runs sequentially - utilizing Safe Offline Harvest)");
    await forceKillChrome(); // Try to kill, but if it fails (other user apps), we rely on copy strategy

    // Create a temp bench for harvesting
    const tempHarvestRoot = path.join(BASE_DIR, "temp_harvest_bench");
    if (fs.existsSync(tempHarvestRoot)) try { fs.rmSync(tempHarvestRoot, { recursive: true, force: true }); } catch (e) { }
    fs.mkdirSync(tempHarvestRoot, { recursive: true });

    for (const pf of profiles) {
        const authFile = path.join(AUTH_CACHE_DIR, `${pf.name}_state.json`);

        // Skip if cache is fresh (< 2 hours)
        if (fs.existsSync(authFile)) {
            const stats = fs.statSync(authFile);
            const ageMs = Date.now() - stats.mtimeMs;
            if (ageMs < 2 * 60 * 60 * 1000) { continue; }
        }

        console.log(`   🎣 Harvesting fresh session for: ${pf.name}...`);
        try {
            // SAFE STRATEGY: Copy critical DBs to temp dir to avoid locking conflicts
            const harvestProfileDir = path.join(tempHarvestRoot, pf.name);
            const harvestUserData = path.join(harvestProfileDir, "User Data");
            const harvestDefault = path.join(harvestUserData, "Default");

            fs.mkdirSync(harvestDefault, { recursive: true });

            const realParent = path.dirname(pf.path); // User Data
            const realProfile = pf.path; // Profile Folder

            // 1. Copy Local State (Key)
            try {
                fs.copyFileSync(path.join(realParent, "Local State"), path.join(harvestUserData, "Local State"));
            } catch (e) { console.log(`      ⚠️ Could not copy Local State (might be missing/locked)`); }

            // 2. Copy Cookies (Data)
            try {
                fs.copyFileSync(path.join(realProfile, "Cookies"), path.join(harvestDefault, "Cookies"));
                // Try Network Cookies if they exist
                const netCookiesDir = path.join(harvestDefault, "Network");
                if (fs.existsSync(path.join(realProfile, "Network", "Cookies"))) {
                    fs.mkdirSync(netCookiesDir, { recursive: true });
                    fs.copyFileSync(path.join(realProfile, "Network", "Cookies"), path.join(netCookiesDir, "Cookies"));
                }
            } catch (e) { }

            // 3. Launch on COPIED data
            const args = [
                "--headless=new",
                "--disable-gpu",
                `--profile-directory=Default`,
                "--no-first-run",
                "--password-store=dpapi"
            ];

            const ctx = await chromium.launchPersistentContext(harvestUserData, {
                executablePath: CONFIG.CHROME_EXE,
                startMaximized: false,
                headless: true,
                args: args
            });

            // Grab state
            const page = ctx.pages().length > 0 ? ctx.pages()[0] : await ctx.newPage();
            await page.waitForTimeout(2000);
            const state = await ctx.storageState();
            fs.writeFileSync(authFile, JSON.stringify(state, null, 2));

            await ctx.close();
            console.log(`      💾 Session saved.`);
            await new Promise(r => setTimeout(r, 500));

        } catch (err) {
            console.log(`      ⚠️ Failed to harvest ${pf.name}: ${err.message}`);
        }
    }
    // Cleanup bench
    try { fs.rmSync(tempHarvestRoot, { recursive: true, force: true }); } catch (e) { }
    console.log("   🔐 All sessions ready.\n");
}

async function injectAuthSession(context, profileName) {
    const authFile = path.join(AUTH_CACHE_DIR, `${profileName}_state.json`);
    if (fs.existsSync(authFile)) {
        try {
            const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
            if (state.cookies) await context.addCookies(state.cookies);
            // LocalStorage injection requires script
            if (state.origins) {
                await context.addInitScript((storage) => {
                    if (window.location.hostname.includes('google')) return; // Careful with overwriting
                    // Simple restoration could be complex; relying mainly on cookies
                }, state);
            }
            console.log(`   💉 Injected valied session for ${profileName}`);
        } catch (e) {
            console.log(`   ⚠️ Failed to inject session: ${e.message}`);
        }
    }
}

// ==========================================
// CONFIGURATION
// ==========================================
const BASE_DIR = "d:\\workspace\\flow";
const CONFIG = {
    PROFILES_DIR: path.join(BASE_DIR, "profiles"),
    OUTPUT_DIR: path.join(BASE_DIR, "images_gemini"),

    // Instruction Enforced
    SYSTEM_INSTRUCTION: `You are an expert cinematic concept artist. 
  I will provide a series of story prompts. You must generate an image for each one.
  CRITICAL RULES:
  1. CONSISTENCY: The character's facial features, clothing, and the environment style must remain exactly the same across all images.
  2. FORMAT: All images must be strictly in 16:9 Widescreen Aspect Ratio (Landscape).
  3. STYLE: Photorealistic, Cinematic lighting, High fidelity.`,

    TIMEOUT_MS: 300000,
    HEADLESS: false,
    ACTION_DELAY: 2000,
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.110 Safari/537.36'
};

// --- BORDERLESS CONFIGURATION ---
// Removed by user request

CONFIG.IS_REAL_CHROME = false;
CONFIG.IS_BORDERLESS = false;
CONFIG.CHROME_EXE = "";
CONFIG.CHROME_USER_DATA = "";
CONFIG.CHROME_PROFILE_DIR = "";

const STATS = {
    storiesCompleted: 0,
    imagesGenerated: 0,
    imagesSkipped: 0,
    failures: 0
};
const GLOBAL_START_TIME = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// ==========================================
// SESSION MANAGEMENT
// ==========================================
function getSessionPath(storyName) {
    return path.join(CONFIG.OUTPUT_DIR, storyName, 'session.json');
}

function saveSession(storyName, url, profileName) {
    const sessionPath = getSessionPath(storyName);
    const data = {
        url: url,
        profileName: profileName,
        lastUpdated: new Date().toISOString()
    };
    try {
        const dir = path.dirname(sessionPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
    } catch (e) { }
}

function loadSession(storyName) {
    const sessionPath = getSessionPath(storyName);
    if (fs.existsSync(sessionPath)) {
        try { return JSON.parse(fs.readFileSync(sessionPath, 'utf8')); } catch (e) { return null; }
    }
    return null;
}

// ==========================================
// BROWSER ACTIONS
// ==========================================
async function setupPage(context, profileName, targetUrl = "https://gemini.google.com/app", existingPage = null) {
    const page = existingPage || await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    // Final verification of login status
    try {
        await page.waitForSelector('div[contenteditable="true"], textarea', { state: 'visible', timeout: 10000 });
        console.log(`✅ [${profileName}] Login Successful.`);
    } catch (e) {
        console.log(`❌ [${profileName}] Login Failed or Timed Out (Check 'debug_fail' screenshot).`);
        throw new Error("Login verification failed");
    }

    // Pro Mode Check
    await checkAndSelectProMode(page);
    return page;
}

async function checkAndSelectProMode(page) {
    try {
        // Just ensure we are in a mode that supports images. 
        // Modern Gemini often defaults correctly, but we try to switch to 2.0 Flash / Pro if visible.
    } catch (e) { }
}

async function switchToImageTool(page) {
    try {
        console.log("   🔧 Checking Image Mode...");
        // 1. Try to find the "Add model" or "Model settings" dropdown if it exists
        // This is often hard to pin down as UI changes. 
        // Strategy: Look for "Generate images" text in the prompt area or a specific tool button.

        // Actually, modern Gemini usually has image gen enabled by default. 
        // We will TRY to click "Tools" -> "Image generation" if it exists, otherwise assume default.

        const toolsButton = page.locator('button').filter({ hasText: /Tools/i }).first();
        if (await toolsButton.count() > 0 && await toolsButton.isVisible()) {
            await toolsButton.click();
            await sleep(500);
            const imgGenOption = page.locator('div[role="menuitem"], button').filter({ hasText: /Image generation/i }).first();
            if (await imgGenOption.isVisible()) {
                await imgGenOption.click();
                console.log("   ✅ Selected 'Image generation' tool.");
                await sleep(500);
            } else {
                // Close menu if option not found
                await page.keyboard.press('Escape');
            }
        }
    } catch (e) {
        console.log("   ⚠️ Could not explicitly select Image Tool (might already be active).");
    }
}

async function generateAndDownloadImage(page, promptText, storyName, promptNumber, includeSystemInstruction) {
    const imageStartTime = Date.now();
    console.log(`🎨 [${storyName}] Processing Prompt #${promptNumber}...`);

    let finalMessage = promptText;
    if (includeSystemInstruction) {
        finalMessage = `${CONFIG.SYSTEM_INSTRUCTION}\n\nSTORY PROMPT:\n${promptText}`;
    } else {
        finalMessage = `${promptText} \n(Maintain 16:9 Landscape Aspect Ratio)`;
    }

    const input = page.locator('div[contenteditable="true"], textarea[aria-label*="Input"]').first();
    await input.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(500);
    await input.fill(finalMessage);
    await sleep(1000);

    const sendButton = page.locator('button[aria-label*="Send"], mat-icon[fonticon="send"]').first();
    await sendButton.click();

    let generationSuccess = false;
    const initialCount = await page.locator('single-image.generated-image').count();

    try {
        await page.waitForFunction((expected) => document.querySelectorAll('single-image.generated-image').length > expected, initialCount, { timeout: CONFIG.TIMEOUT_MS });
        generationSuccess = true;
    } catch (e) {
        console.log(`   ⚠️ [${storyName}] Timeout waiting for image!`);
    }

    if (!generationSuccess) {
        STATS.failures++;
        return false;
    }

    try {
        const newContainer = page.locator('single-image.generated-image').last();
        await newContainer.waitFor({ state: 'attached', timeout: 30000 });
        await sleep(2000);

        const downloadBtn = newContainer.locator('button[data-test-id="download-generated-image-button"]');
        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        await downloadBtn.click();
        const download = await downloadPromise;

        const storyDir = path.join(CONFIG.OUTPUT_DIR, storyName);
        if (!fs.existsSync(storyDir)) fs.mkdirSync(storyDir, { recursive: true });

        const savePath = path.join(storyDir, `${promptNumber}.jpg`);
        await download.saveAs(savePath);

        STATS.imagesGenerated++;
        console.log(`   ✅ [${storyName}] Saved: ${promptNumber}.jpg`);
        return true;
    } catch (e) {
        console.log(`   ❌ [${storyName}] Download Error: ${e.message}`);
        STATS.failures++;
        return false;
    }
}

// ==========================================
// MAIN
// ==========================================
async function main() {

    console.log('\nSelect Generation Mode:');
    console.log('  1. Story Mode (Consistent Character/Setting) - Maintains chat context per file.');
    console.log('  2. Bulk Mode (Fast/Independent) - Parallelizes all prompts, no context retention.');
    const modeChoice = readlineSync.questionInt('\nEnter your choice (1 or 2): ');

    const isStoryMode = modeChoice === 1;
    console.log(`▶️ Selected: ${isStoryMode ? 'Story Mode 📖' : 'Bulk Mode ⚡'}\n`);

    const promptManager = new PromptManager(BASE_DIR);
    const allPrompts = promptManager.loadAllPrompts();
    if (allPrompts.length === 0) { console.log("No prompts found."); return; }

    let profileFiles = [];
    // Load Bundled Profiles
    const files = fs.readdirSync(CONFIG.PROFILES_DIR).filter(f => f.endsWith('.json'));
    profileFiles = files.map(f => ({ name: path.parse(f).name, path: path.join(CONFIG.PROFILES_DIR, f) }));

    if (profileFiles.length === 0) { console.log("No profiles found."); return; }

    let workQueue = [];
    if (isStoryMode) {
        const stories = {};
        for (const p of allPrompts) {
            if (!stories[p.filename]) stories[p.filename] = [];
            stories[p.filename].push(p);
        }
        workQueue = Object.values(stories);
    } else {
        workQueue = [...allPrompts];
    }

    let browser = null;
    if (!CONFIG.IS_REAL_CHROME) {
        browser = await chromium.launch({ headless: CONFIG.HEADLESS, args: ["--start-maximized"] });
    }

    let selectedProfiles = [];
    if (isStoryMode) {
        const requiredProfiles = new Set();
        const unclaimedStoriesCount = workQueue.filter(story => {
            const sPath = getSessionPath(story[0].filename);
            if (fs.existsSync(sPath)) {
                try {
                    const sess = JSON.parse(fs.readFileSync(sPath));
                    if (sess.profileName) { requiredProfiles.add(sess.profileName); return false; }
                } catch (e) { }
            }
            return true;
        }).length;

        console.log(`📋 Planning: ${requiredProfiles.size} Resumed Stories, ${unclaimedStoriesCount} New Stories.`);

        const usedProfileNames = new Set();
        profileFiles.forEach(pf => {
            if (requiredProfiles.has(pf.name)) {
                selectedProfiles.push(pf);
                usedProfileNames.add(pf.name);
            }
        });

        let neededExtras = unclaimedStoriesCount;
        for (const pf of profileFiles) {
            if (neededExtras <= 0) break;
            if (!usedProfileNames.has(pf.name)) {
                selectedProfiles.push(pf);
                usedProfileNames.add(pf.name);
                neededExtras--;
            }
        }
    } else {
        selectedProfiles = [...profileFiles];
    }

    console.log(`🚀 Launching ${selectedProfiles.length} Worker(s) for the job...`);
    if (selectedProfiles.length === 0) {
        console.log("❌ No profiles available.");
        if (browser) await browser.close();
        return;
    }

    const workers = selectedProfiles.map((pf, i) => {
        return (async () => {
            const profileName = pf.name;
            const profilePath = pf.path;
            console.log(`🤖 Worker ${i + 1}: Starting (${profileName})`);

            let context, page;
            let sessionRefreshInterval = null;

            try {
                context = await browser.newContext({ storageState: profilePath, userAgent: CONFIG.USER_AGENT });
                page = await context.newPage();

                page = await setupPage(context, profileName);
                console.log(`🤖 Worker ${i + 1}: Ready (${profileName})`);

                while (workQueue.length > 0) {
                    if (isStoryMode) {
                        let storyIndex = -1;
                        for (let k = 0; k < workQueue.length; k++) {
                            const sess = loadSession(workQueue[k][0].filename);
                            if (sess && sess.profileName === profileName) { storyIndex = k; break; }
                        }
                        if (storyIndex === -1) {
                            for (let k = 0; k < workQueue.length; k++) {
                                if (!loadSession(workQueue[k][0].filename)) { storyIndex = k; break; }
                            }
                        }
                        if (storyIndex === -1) break;

                        const storyPrompts = workQueue.splice(storyIndex, 1)[0];
                        const filename = storyPrompts[0].filename;
                        console.log(`📘 Worker ${i + 1}: Starting Story: ${filename}`);

                        const savedSession = loadSession(filename);
                        if (savedSession && savedSession.profileName === profileName) {
                            if (page.url() !== savedSession.url) {
                                await page.goto(savedSession.url);
                                await sleep(3000);
                            }
                        } else {
                            await page.goto("https://gemini.google.com/app");
                            await sleep(3000);
                        }

                        await switchToImageTool(page);
                        let firstSent = false;
                        for (const promptData of storyPrompts) {
                            const imgPath = path.join(CONFIG.OUTPUT_DIR, filename, `${promptData.promptIndex}.jpg`);
                            if (fs.existsSync(imgPath)) { STATS.imagesSkipped++; continue; }

                            const shouldIncludeSystem = !firstSent && (!savedSession || savedSession.profileName !== profileName);
                            const success = await generateAndDownloadImage(page, promptData.text, filename, promptData.promptIndex, shouldIncludeSystem);
                            if (success) {
                                if (!firstSent) { saveSession(filename, page.url(), profileName); firstSent = true; }
                                promptManager.updateStatus(filename, 'completed');
                            } else {
                                promptManager.updateStatus(filename, 'failed');
                            }
                            await sleep(CONFIG.ACTION_DELAY);
                        }
                        STATS.storiesCompleted++;
                    } else {
                        const promptData = workQueue.shift();
                        if (!promptData) break;
                        const imgPath = path.join(CONFIG.OUTPUT_DIR, promptData.filename, `${promptData.promptIndex}.jpg`);
                        if (fs.existsSync(imgPath)) { STATS.imagesSkipped++; continue; }

                        await switchToImageTool(page);
                        const success = await generateAndDownloadImage(page, promptData.text, promptData.filename, promptData.promptIndex, true);
                        if (success) {
                            promptManager.updateStatus(promptData.filename, 'completed');
                        } else {
                            promptManager.updateStatus(promptData.filename, 'failed');
                        }
                        await sleep(CONFIG.ACTION_DELAY);
                    }
                }
            } catch (err) {
                console.log(`❌ Worker ${i + 1} Error: ${err.message}`);
                // Try screenshot on fail
                if (context && context.pages().length > 0) {
                    try {
                        const debugPath = path.join(BASE_DIR, `debug_fail_${profileName}_${Date.now()}.png`);
                        await context.pages()[0].screenshot({ path: debugPath });
                        console.log(`   📸 Error screenshot saved: ${debugPath}`);
                    } catch (e) { }
                }
            } finally {
                if (sessionRefreshInterval) clearInterval(sessionRefreshInterval);
                if (page && !page.isClosed()) { try { await page.close(); } catch (e) { } }
                if (context) { try { await context.close(); } catch (e) { } }
            }
        })();
    });

    await Promise.all(workers);
    if (browser) await browser.close();
    console.log("\n========================================");
    console.log("🎉 DONE");
    console.log(`Generated: ${STATS.imagesGenerated} | Skipped: ${STATS.imagesSkipped} | Failed: ${STATS.failures}`);
    console.log("========================================");
}

main();