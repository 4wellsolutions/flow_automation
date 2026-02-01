const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    PROFILES_DIR: "d:\\workspace\\flow\\profiles",
    URL: "https://gemini.google.com/app",
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
};

async function checkProfiles() {
    console.log("🔍 Checking Profile Status...");

    if (!fs.existsSync(CONFIG.PROFILES_DIR)) {
        console.log("❌ Profiles directory not found.");
        return;
    }

    const files = fs.readdirSync(CONFIG.PROFILES_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log("❌ No profiles found.");
        return;
    }

    const browser = await chromium.launch({ headless: true }); // Headless for speed

    console.log(`\nFound ${files.length} profiles. Testing login status...\n`);
    console.log("----------------------------------------");

    for (const file of files) {
        const profileName = path.parse(file).name;
        const profilePath = path.join(CONFIG.PROFILES_DIR, file);
        let status = "❓ Unknown";

        try {
            const context = await browser.newContext({
                storageState: profilePath,
                userAgent: CONFIG.USER_AGENT
            });
            const page = await context.newPage();

            // Go to Gemini
            await page.goto(CONFIG.URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Check for login indicator (textarea or contenteditable)
            try {
                await page.waitForSelector('div[contenteditable="true"], textarea', { state: 'visible', timeout: 10000 });
                status = "✅ LOGGED IN";
            } catch (e) {
                // Check if sign-in button exists
                const signIn = await page.locator('a[href*="accounts.google.com"]').count();
                if (signIn > 0) status = "❌ LOGGED OUT";
                else status = "⚠️  UNCERTAIN (Timeout/Error)";
            }

            await context.close();
        } catch (e) {
            status = `❌ ERROR: ${e.message}`;
        }

        console.log(`User: ${profileName.padEnd(20)} | Status: ${status}`);
    }

    console.log("----------------------------------------");
    await browser.close();
    console.log("\nDone.");
}

checkProfiles();
