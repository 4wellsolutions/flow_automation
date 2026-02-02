const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Config
const BASE_DIR = __dirname;
const PROFILES_DIR = path.join(BASE_DIR, 'profiles');
const DISABLED_DIR = path.join(PROFILES_DIR, 'disabled');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
if (!fs.existsSync(DISABLED_DIR)) fs.mkdirSync(DISABLED_DIR, { recursive: true });

let activeBrowser = null;
let activeContext = null;
let activePage = null;
let activeProfileName = null;

app.use(express.static(path.join(__dirname, 'tools', 'profile_manager', 'public')));
app.use(express.json());

// API: List Profiles
app.get('/api/profiles', (req, res) => {
    try {
        const activeFiles = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
        const disabledFiles = fs.readdirSync(DISABLED_DIR).filter(f => f.endsWith('.json'));

        const profiles = [];

        activeFiles.forEach(file => {
            const stats = fs.statSync(path.join(PROFILES_DIR, file));
            profiles.push({ name: path.parse(file).name, size: stats.size, status: 'active' });
        });

        disabledFiles.forEach(file => {
            const stats = fs.statSync(path.join(DISABLED_DIR, file));
            profiles.push({ name: path.parse(file).name, size: stats.size, status: 'inactive' });
        });

        console.log(`Debug: activeFiles found: ${activeFiles.length}, disabledFiles found: ${disabledFiles.length}`);
        console.log(`Debug First Profile:`, profiles[0]);

        res.json(profiles);
    } catch (e) {
        res.status(500).json([]);
    }
});

// API: Toggle Profile Status
app.post('/api/toggle-status', (req, res) => {
    console.log(`[API] HIT: /api/toggle-status`);
    try {
        const { profileName, currentStatus } = req.body;
        if (!profileName) return res.status(400).json("Name required");

        const filename = `${profileName}.json`;
        let source, dest;

        if (currentStatus === 'active') {
            source = path.join(PROFILES_DIR, filename);
            dest = path.join(DISABLED_DIR, filename);
        } else {
            source = path.join(DISABLED_DIR, filename);
            dest = path.join(PROFILES_DIR, filename);
        }

        if (fs.existsSync(source)) {
            fs.renameSync(source, dest);
            console.log(`Moved ${profileName}: ${currentStatus} -> ${currentStatus === 'active' ? 'inactive' : 'active'}`);
            res.json({ success: true });
        } else {
            res.status(404).json("Profile file not found");
        }
    } catch (e) {
        console.error(e);
        res.status(500).json(e.message);
    }
});

// API: Launch Browser for Login
app.post('/api/launch', async (req, res) => {
    try {
        const { profileName } = req.body;
        if (!profileName) return res.status(400).json("Profile name required");

        if (activeBrowser) await activeBrowser.close();

        activeProfileName = profileName;
        console.log(`Launching browser for: ${profileName}`);

        activeBrowser = await chromium.launch({
            headless: false,
            args: ["--start-maximized"] // User sees this window to login
        });

        // Use consistent Context
        activeContext = await activeBrowser.newContext({
            userAgent: USER_AGENT,
            viewport: null
        });

        activePage = await activeContext.newPage();
        await activePage.goto("https://accounts.google.com/");

        res.json("Browser launched");
    } catch (e) {
        console.error(e);
        res.status(500).json(e.message);
    }
});

// API: Save Profile
app.post('/api/save', async (req, res) => {
    try {
        if (!activeContext || !activeProfileName) return res.status(400).json("No active session");

        const filePath = path.join(PROFILES_DIR, `${activeProfileName}.json`);
        await activeContext.storageState({ path: filePath });
        console.log(`Saved profile: ${filePath}`);

        await activeBrowser.close();
        activeBrowser = null;
        activeContext = null;
        activePage = null;
        activeProfileName = null;

        res.json("Profile saved");
    } catch (e) {
        console.error(e);
        res.status(500).json(e.message);
    }
});

// API: Check Status
app.post('/api/check-status', async (req, res) => {
    const { profileName } = req.body;
    if (!profileName) return res.status(400).send("Profile name required");

    console.log(`Checking status for: ${profileName}...`);
    let browser = null;

    try {
        browser = await chromium.launch({ headless: true });
        const filePath = path.join(PROFILES_DIR, `${profileName}.json`);

        if (!fs.existsSync(filePath)) return res.json({ status: "MISSING", message: "File not found" });

        const context = await browser.newContext({
            storageState: filePath,
            userAgent: USER_AGENT // Enforce same UA for check
        });
        const page = await context.newPage();

        await page.goto("https://gemini.google.com/app", { waitUntil: 'domcontentloaded', timeout: 20000 });

        let status = "UNKNOWN";
        try {
            await page.waitForSelector('div[contenteditable="true"], textarea', { state: 'visible', timeout: 8000 });
            status = "LOGGED_IN";
        } catch (e) {
            const signIn = await page.locator('a[href*="accounts.google.com"]').count();
            if (signIn > 0) status = "LOGGED_OUT";
            else status = "ERROR";
        }

        await browser.close();
        res.json({ status });

    } catch (e) {
        if (browser) await browser.close();
        res.status(500).json({ status: "ERROR", message: e.message });
    }
});

// API: Check Flow Status (VideoFX)
app.post('/api/check-flow-status', async (req, res) => {
    const { profileName } = req.body;
    if (!profileName) return res.status(400).send("Profile name required");

    console.log(`Checking FLOW status for: ${profileName}...`);
    let browser = null;

    try {
        browser = await chromium.launch({ headless: true });
        const filePath = path.join(PROFILES_DIR, `${profileName}.json`);

        if (!fs.existsSync(filePath)) return res.json({ status: "MISSING", message: "File not found" });

        const context = await browser.newContext({
            storageState: filePath,
            userAgent: USER_AGENT // Enforce same UA for check
        });
        const page = await context.newPage();

        await page.goto("https://labs.google/fx/tools/flow/", { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000)); // Wait for redirect/load

        let status = "UNKNOWN";
        try {
            // Check for login button which implies logged out
            const signIn = await page.getByText("Sign in", { exact: false }).count();
            const signInBtn = await page.locator('button:has-text("Sign in")').count();

            // Check for known logged-in element (e.g. settings cog, or canvas)
            let canvas = await page.locator('canvas').count();
            let loggedInText = await page.getByText("Text to Video", { exact: false }).count();
            let createBtn = await page.locator('button:has-text("Create with Flow")');

            if (await createBtn.count() > 0) {
                console.log("Found 'Create with Flow' button, clicking...");
                await createBtn.click();
                await new Promise(r => setTimeout(r, 3000)); // Wait for transition
                // Re-check elements after click
                canvas = await page.locator('canvas').count();
                loggedInText = await page.getByText("Text to Video", { exact: false }).count();
            }

            const newProjectBtn = await page.getByText("New project", { exact: false }).count();

            if (signIn > 0 || signInBtn > 0) {
                status = "LOGGED_OUT";
            } else if (canvas > 0 || loggedInText > 0 || newProjectBtn > 0) {
                status = "LOGGED_IN";
            } else {
                status = "UNCERTAIN";
                // If no sign-in button found, likely logged in or loading error
                if (await page.title().then(t => t.includes("Flow"))) status = "LOGGED_IN";
            }
        } catch (e) {
            status = "ERROR";
        }

        await browser.close();
        res.json({ status });

    } catch (e) {
        if (browser) await browser.close();
        res.status(500).json({ status: "ERROR", message: e.message });
    }
});

// API: Clear Profile Cache (localStorage/sessionStorage)
app.post('/api/clear-cache', (req, res) => {
    try {
        const { profileName } = req.body;
        if (!profileName) return res.status(400).json("Profile name required");

        const activePath = path.join(PROFILES_DIR, `${profileName}.json`);
        const disabledPath = path.join(DISABLED_DIR, `${profileName}.json`);

        const filePath = fs.existsSync(activePath) ? activePath : (fs.existsSync(disabledPath) ? disabledPath : null);

        if (!filePath) return res.status(404).json("Profile not found");

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Clear origins (localStorage, sessionStorage) but keep cookies
        data.origins = [];

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Cleared cache for: ${profileName}`);
        res.json("Cache cleared");
    } catch (e) {
        console.error(e);
        res.status(500).json(e.message);
    }
});

// API: Delete Profile
app.delete('/api/delete', (req, res) => {
    try {
        const { profileName } = req.body;
        if (!profileName) return res.status(400).json("Profile name required");

        const activePath = path.join(PROFILES_DIR, `${profileName}.json`);
        const disabledPath = path.join(DISABLED_DIR, `${profileName}.json`);

        if (fs.existsSync(activePath)) {
            fs.unlinkSync(activePath);
            console.log(`Deleted profile: ${profileName}`);
            res.json("Profile deleted");
        } else if (fs.existsSync(disabledPath)) {
            fs.unlinkSync(disabledPath);
            console.log(`Deleted inactive profile: ${profileName}`);
            res.json("Profile deleted");
        } else {
            res.status(404).json("Profile not found");
        }
    } catch (e) {
        console.error(e);
        res.status(500).json(e.message);
    }
});

app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`Profile Manager v2.1 (Toggle Support)`);
    console.log(`Running at http://localhost:${PORT}`);
    console.log(`=========================================`);
});
