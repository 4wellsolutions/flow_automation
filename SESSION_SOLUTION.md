# Flow Automation - Permanent Session Solution

## 🎯 Problem Solved
Your profiles were showing "signed out" because Google sessions expire over time. This solution keeps your sessions alive **permanently** without needing to re-login constantly.

## ✅ Permanent Solution Implemented

### 1. **Auto-Validation Before Every Run**
- `gemini_images.js` now automatically validates all profiles before starting
- Refreshes session cookies to extend their lifetime
- Warns you if any profiles need re-login

### 2. **Continuous Session Refresh During Work**
- Sessions are automatically saved every 30 minutes while working
- Prevents timeout during long-running operations
- No more mid-work logouts!

### 3. **Background Session Keeper (Optional)**
- Run `session_keeper.js` in the background to keep ALL sessions alive 24/7
- Automatically refreshes sessions every 6 hours
- Prevents any profile from expiring

## 🚀 How to Use

### Daily Workflow (Recommended)
Just run your normal command:
```bash
node gemini_images.js
```

The script will:
1. ✅ Auto-check all profiles
2. ✅ Refresh valid sessions
3. ✅ Warn about invalid profiles
4. ✅ Keep sessions alive during work

### Background Session Keeper (Optional - For Maximum Reliability)
Keep this running in a separate terminal 24/7:
```bash
node session_keeper.js
```

This will refresh all profiles every 6 hours automatically.

To run once (manual refresh):
```bash
node session_keeper.js --once
```

### If Profiles Still Show Logged Out
1. Run the profile manager:
   ```bash
   node manage_profiles.js
   ```
2. Open http://localhost:3000 in your browser
3. Click "Check Status" to see which profiles need login
4. For logged-out profiles:
   - Click "Launch Browser"
   - Login manually
   - Click "Save Profile"

## 🔧 Configuration

Edit `session_keeper.js` to change refresh interval:
```javascript
REFRESH_INTERVAL_HOURS: 6  // Change to 3, 12, 24, etc.
```

## 📊 What Changed

### `gemini_images.js`
- ✅ Added `validateAndRefreshSessions()` function
- ✅ Auto-validates before starting work
- ✅ Saves sessions every 30 minutes during operation
- ✅ Filters out invalid profiles automatically

### `session_keeper.js` (NEW)
- ✅ Background service to keep sessions alive
- ✅ Validates and refreshes all profiles periodically
- ✅ Reports which profiles need attention

## 💡 Tips

1. **First Time Setup**: Login to all profiles once using `manage_profiles.js`
2. **Daily Use**: Just run `gemini_images.js` - it handles everything
3. **Long-term**: Run `session_keeper.js` in background for zero maintenance
4. **If Issues Persist**: Some Google accounts have stricter security - you may need to:
   - Disable 2FA temporarily
   - Use "App Passwords" instead of regular passwords
   - Add the device to "Trusted Devices" in Google Account settings

## 🎉 Result
**No more constant re-logins!** Your sessions stay alive indefinitely with automatic refresh.
