const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const readlineSync = require('readline-sync');
const PromptManager = require('./utils/prompt_manager');

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
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36' // Use a static UA for better compatibility
};

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
async function setupPage(context, profileName, targetUrl = "https://gemini.google.com/app") {
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    // Check Login
    try {
        await page.waitForSelector('div[contenteditable="true"], textarea', { state: 'visible', timeout: 15000 });
    } catch (error) {
        console.log(`   ⚠️ [${profileName}] Session validation failed. Reloading...`);
        await page.reload();
        try {
            await page.waitForSelector('div[contenteditable="true"], textarea', { state: 'visible', timeout: 30000 });
        } catch (e2) {
            console.log(`   ❌ [${profileName}] Profile might be expired or logged out.`);
            throw new Error("Login Failed");
        }
    }

    // Set Pro Model if available
    try {
        const modeTrigger = page.locator('div[data-test-id="bard-mode-menu-button"]');
        if (await modeTrigger.count() > 0 && await modeTrigger.isVisible()) {
            const txt = await modeTrigger.innerText();
            if (!txt.includes("Pro") && !txt.includes("Advanced")) {
                await modeTrigger.click();
                await sleep(1000);
                const proOption = page.locator('button[role="menuitem"]').filter({ hasText: /Pro|Advanced/i }).first();
                if (await proOption.isVisible()) {
                    await proOption.click();
                    await sleep(2000);
                }
            }
        }
    } catch (e) { }

    return page;
}

async function switchToImageTool(page) {
    try {
        const toolsButton = page.locator('button.toolbox-drawer-button').filter({ hasText: 'Tools' }).first();
        // Only click if not already active? Hard to tell. Just try.
        if (await toolsButton.isVisible()) {
            await toolsButton.click();
            const createImgBtn = page.locator('button, div[role="menuitem"]').filter({ hasText: /Create image/i }).first();
            if (await createImgBtn.isVisible()) {
                await createImgBtn.click();
                await sleep(1000);
            } else {
                // Close menu if option not found
                await page.keyboard.press('Escape');
            }
        }
    } catch (e) { }
}

async function generateAndDownloadImage(page, promptText, storyName, promptNumber, includeSystemInstruction) {
    const imageStartTime = Date.now();
    console.log(`🎨 [${storyName}] Processing Prompt #${promptNumber}...`);

    let finalMessage = promptText;
    if (includeSystemInstruction) {
        finalMessage = `${CONFIG.SYSTEM_INSTRUCTION}\n\nSTORY PROMPT:\n${promptText}`;
    } else {
        // For subsequent prompts, just send the text, maybe with a small reminder suffix
        finalMessage = `${promptText} \n(Maintain 16:9 Landscape Aspect Ratio)`;
    }

    // Clear and Enter Prompt
    const input = page.locator('div[contenteditable="true"], textarea[aria-label*="Input"]').first();
    await input.click();

    // Clear input Robustly
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(500);

    await input.fill(finalMessage);
    await sleep(1000);

    const sendButton = page.locator('button[aria-label*="Send"], mat-icon[fonticon="send"]').first();
    await sendButton.click();

    // Wait for Generation
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

    // Download
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

        // Check if filename needs padding or specific format? 
        // User used `${promptNumber}.jpg`
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

    const profileFiles = fs.readdirSync(CONFIG.PROFILES_DIR).filter(f => f.endsWith('.json'));
    if (profileFiles.length === 0) { console.log("No profiles found."); return; }

    // Queue Setup
    let workQueue = [];
    if (isStoryMode) {
        // Group by filename for Story Mode
        const stories = {};
        for (const p of allPrompts) {
            if (!stories[p.filename]) stories[p.filename] = [];
            stories[p.filename].push(p);
        }
        workQueue = Object.values(stories); // Array of arrays (Stories)
    } else {
        // Flat list for Bulk Mode
        workQueue = [...allPrompts];
    }

    const browser = await chromium.launch({ headless: CONFIG.HEADLESS });

    const workers = profileFiles.map((pf, i) => {
        return (async () => {
            const profilePath = path.join(CONFIG.PROFILES_DIR, pf);
            const context = await browser.newContext({ storageState: profilePath, userAgent: CONFIG.USER_AGENT });
            const profileName = path.parse(pf).name;
            console.log(`🤖 Worker ${i + 1}: Ready (${profileName})`);

            let page = null;

            try {
                // Initial Page Setup (Done once per worker in Bulk Mode, or per story in Story Mode)
                page = await setupPage(context, profileName);

                while (workQueue.length > 0) {
                    // === STORY MODE LOGIC ===
                    if (isStoryMode) {
                        const storyPrompts = workQueue.shift();
                        if (!storyPrompts) break;

                        const filename = storyPrompts[0].filename;
                        console.log(`📘 Worker ${i + 1}: Starting Story: ${filename}`);

                        // Context handling: Check if we need to resume a specific session
                        const savedSession = loadSession(filename);

                        // If we are switching stories, we might need a Clean Page or Reset Context to avoid bleeding context
                        // Check if current URL matches saved session
                        if (savedSession && savedSession.profileName === profileName) {
                            if (page.url() !== savedSession.url) {
                                console.log(`   ↻ Restoring session for ${filename}...`);
                                await page.goto(savedSession.url);
                                await sleep(3000);
                            }
                        } else {
                            // New Story or different profile: Go to Home to start fresh chat
                            if (page.url().includes('/app/')) {
                                console.log(`   ✨ New Chat for ${filename}...`);
                                await page.goto("https://gemini.google.com/app");
                                await sleep(2000);
                            }
                        }

                        // Ensure Image Tool is selected (sometimes resets on new chat)
                        await switchToImageTool(page);

                        let firstSent = false;
                        // Check if we are resuming a story in-progress (middle of prompts)
                        // If so, we assume the chat context is sufficient.

                        for (const promptData of storyPrompts) {
                            const imgPath = path.join(CONFIG.OUTPUT_DIR, filename, `${promptData.promptIndex}.jpg`);
                            if (fs.existsSync(imgPath)) {
                                console.log(`   ⏩ [${filename}] #${promptData.promptIndex} exists.`);
                                STATS.imagesSkipped++;
                                promptManager.updateStatus(filename, 'skipped');
                                continue;
                            }

                            // If this is the very first prompt we are sending in this *script run* for this story,
                            // AND there is no saved session (or we just started a new chat), we should include system constraints.
                            const shouldIncludeSystem = !firstSent && (!savedSession || savedSession.profileName !== profileName);

                            const success = await generateAndDownloadImage(page, promptData.text, filename, promptData.promptIndex, shouldIncludeSystem);
                            if (success) {
                                if (!firstSent) {
                                    saveSession(filename, page.url(), profileName);
                                    firstSent = true;
                                }
                                promptManager.updateStatus(filename, 'completed');
                            } else {
                                promptManager.updateStatus(filename, 'failed');
                            }
                            await sleep(CONFIG.ACTION_DELAY);
                        }
                        STATS.storiesCompleted++;
                    }

                    // === BULK MODE LOGIC ===
                    else {
                        const promptData = workQueue.shift();
                        if (!promptData) break;

                        // Check exist
                        const imgPath = path.join(CONFIG.OUTPUT_DIR, promptData.filename, `${promptData.promptIndex}.jpg`);
                        if (fs.existsSync(imgPath)) {
                            console.log(`   ⏩ [${promptData.filename}] #${promptData.promptIndex} exists.`);
                            STATS.imagesSkipped++;
                            promptManager.updateStatus(promptData.filename, 'skipped');
                            continue;
                        }

                        // Ensure Image Tool
                        await switchToImageTool(page);

                        // In Bulk Mode, every prompt is treated as a fresh request or continuation of a chaotic chat.
                        // To be safe and fast, we just include the system instruction prefix every time?
                        // OR: We rely on "Pro" model handling it.
                        // Let's include system instruction = true to be safe, so every image enforces 16:9.
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
            } finally {
                if (page) await page.close();
                await context.close();
            }
        })();
    });

    await Promise.all(workers);
    await browser.close();
    console.log("\n========================================");
    console.log("🎉 DONE");
    console.log(`Generated: ${STATS.imagesGenerated} | Skipped: ${STATS.imagesSkipped} | Failed: ${STATS.failures}`);
    console.log("========================================");
}

main();