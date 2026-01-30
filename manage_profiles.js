const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Config
// Config
const PROFILES_DIR = path.join(__dirname, 'profiles');
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'tools', 'profile_manager', 'public')));
app.use(express.json());

// API: List Profiles
app.get('/api/profiles', (req, res) => {
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
    const profiles = files.map(f => ({
        name: path.parse(f).name,
        size: fs.statSync(path.join(PROFILES_DIR, f)).size
    }));
    res.json(profiles);
});

// Track active session
let activeSession = null;

// API: Create/Login Profile
app.post('/api/launch', async (req, res) => {
    const { profileName } = req.body;
    if (!profileName) return res.status(400).send("Profile name required");

    if (activeSession) {
        try { await activeSession.browser.close(); } catch (e) { }
        activeSession = null;
    }

    console.log(`Starting login for profile: ${profileName}...`);

    try {
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto('https://accounts.google.com/signin/v2/identifier', { waitUntil: 'domcontentloaded' });

        activeSession = { browser, context, profileName };

        res.json({ message: "Browser launched. Log in, then click 'Save Profile' here." });

    } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(500).send(e.message);
    }
});

// API: Save Profile
app.post('/api/save', async (req, res) => {
    if (!activeSession) return res.status(400).send("No active browser session.");

    try {
        const { context, profileName, browser } = activeSession;
        const storageState = await context.storageState();
        const filePath = path.join(PROFILES_DIR, `${profileName}.json`);
        fs.writeFileSync(filePath, JSON.stringify(storageState, null, 2));
        console.log(`Saved to ${filePath}`);

        await browser.close();
        activeSession = null;

        res.json({ success: true, message: `Profile '${profileName}' saved successfully!` });
    } catch (e) {
        console.error(e);
        res.status(500).send("Failed to save profile: " + e.message);
    }
});

app.listen(PORT, () => {
    console.log(`Profile Manager running at http://localhost:${PORT}`);
});
