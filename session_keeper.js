const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    PROFILES_DIR: "d:\\workspace\\flow\\profiles",
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    REFRESH_INTERVAL_HOURS: 6, // Refresh sessions every 6 hours
    FLOW_URL: "https://labs.google/fx/tools/flow/",
    GEMINI_URL: "https://gemini.google.com/app"
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Validates and refreshes a single profile session
 */
async function refreshProfile(browser, profilePath, profileName) {
    console.log(`\n🔄 Refreshing: ${profileName}...`);

    try {
        const context = await browser.newContext({
            storageState: profilePath,
            userAgent: CONFIG.USER_AGENT,
            viewport: null
        });

        const page = await context.newPage();

        // Test Flow access first (primary use case)
        await page.goto(CONFIG.FLOW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(5000);

        // Check if logged in
        const signInBtn = await page.locator('button:has-text("Sign in")').count();
        const signInText = await page.getByText("Sign in", { exact: false }).count();

        if (signInBtn > 0 || signInText > 0) {
            console.log(`   ⚠️  ${profileName} is LOGGED OUT on Flow`);

            // Try to handle "Choose account" screen
            try {
                const accountSelector = 'ul li div[data-email]';
                await page.waitForSelector(accountSelector, { timeout: 3000 });

                const accounts = await page.$$(accountSelector);
                for (const acc of accounts) {
                    const email = await acc.getAttribute('data-email');
                    if (email && profileName.includes(email)) {
                        console.log(`   🔐 Selecting account: ${email}`);
                        await acc.click();
                        await sleep(5000);
                        break;
                    }
                }

                // Re-check after selection
                const stillLoggedOut = await page.locator('button:has-text("Sign in")').count();
                if (stillLoggedOut > 0) {
                    console.log(`   ❌ ${profileName} - Manual login required`);
                    await context.close();
                    return { success: false, needsLogin: true };
                }
            } catch (e) {
                console.log(`   ❌ ${profileName} - Manual login required`);
                await context.close();
                return { success: false, needsLogin: true };
            }
        }

        // Also validate Gemini access
        await page.goto(CONFIG.GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);

        try {
            await page.waitForSelector('div[contenteditable="true"], textarea', { state: 'visible', timeout: 8000 });
            console.log(`   ✅ ${profileName} - Session validated and refreshed`);
        } catch (e) {
            console.log(`   ⚠️  ${profileName} - Gemini access uncertain, but Flow OK`);
        }

        // Save refreshed session state
        await context.storageState({ path: profilePath });
        console.log(`   💾 ${profileName} - Session saved`);

        await context.close();
        return { success: true, needsLogin: false };

    } catch (e) {
        console.log(`   ❌ ${profileName} - Error: ${e.message}`);
        return { success: false, needsLogin: false, error: e.message };
    }
}

/**
 * Main refresh loop
 */
async function keepSessionsAlive(runOnce = false) {
    console.log("🔐 Session Keeper Started");
    console.log(`📋 Refresh Interval: ${CONFIG.REFRESH_INTERVAL_HOURS} hours`);

    if (!fs.existsSync(CONFIG.PROFILES_DIR)) {
        console.log("❌ Profiles directory not found.");
        return;
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"]
    });

    while (true) {
        const files = fs.readdirSync(CONFIG.PROFILES_DIR).filter(f => f.endsWith('.json'));

        if (files.length === 0) {
            console.log("❌ No profiles found.");
            break;
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`🕐 ${new Date().toLocaleString()}`);
        console.log(`📊 Refreshing ${files.length} profiles...`);
        console.log(`${'='.repeat(50)}`);

        const results = {
            success: 0,
            needsLogin: 0,
            errors: 0
        };

        for (const file of files) {
            const profileName = path.parse(file).name;
            const profilePath = path.join(CONFIG.PROFILES_DIR, file);

            const result = await refreshProfile(browser, profilePath, profileName);

            if (result.success) results.success++;
            else if (result.needsLogin) results.needsLogin++;
            else results.errors++;

            await sleep(2000); // Small delay between profiles
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`📈 Summary:`);
        console.log(`   ✅ Success: ${results.success}`);
        console.log(`   ⚠️  Needs Login: ${results.needsLogin}`);
        console.log(`   ❌ Errors: ${results.errors}`);
        console.log(`${'='.repeat(50)}\n`);

        if (runOnce) break;

        const waitMs = CONFIG.REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
        console.log(`⏰ Next refresh in ${CONFIG.REFRESH_INTERVAL_HOURS} hours...`);
        await sleep(waitMs);
    }

    await browser.close();
    console.log("\n✅ Session Keeper Stopped");
}

// Run mode
const runOnce = process.argv.includes('--once');
keepSessionsAlive(runOnce);
