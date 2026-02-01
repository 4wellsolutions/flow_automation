const fs = require('fs');
const path = require('path');

class PromptManager {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.promptsDir = path.join(baseDir, 'prompts');
        this.doneDir = path.join(this.promptsDir, 'done');
        this.retryFile = path.join(this.promptsDir, 'prompts_fail.txt');

        // Ensure directories exist
        if (!fs.existsSync(this.promptsDir)) fs.mkdirSync(this.promptsDir, { recursive: true });
        if (!fs.existsSync(this.doneDir)) fs.mkdirSync(this.doneDir, { recursive: true });

        this.promptFileStatus = new Map();
    }

    /**
     * Loads all prompts from .txt files in the prompts directory.
     * Parses numbered lists (e.g. "1. Prompt...") or double-newline blocks.
     */
    loadAllPrompts() {
        console.log(`\n📂 Loading prompts from: ${this.promptsDir}`);
        const files = fs.readdirSync(this.promptsDir)
            .filter(f => f.endsWith('.txt') && !f.includes('fail') && !f.includes('success'))
            .sort();

        const allPrompts = [];

        for (const file of files) {
            const filePath = path.join(this.promptsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const prompts = this._parseContent(content);
            const baseName = path.parse(file).name;

            // Initialize tracking
            this.promptFileStatus.set(baseName, {
                total: prompts.length,
                completed: 0,
                failed: 0,
                skipped: 0
            });

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

        console.log(`✅ Total: ${allPrompts.length} prompt(s) from ${files.length} file(s)`);
        return allPrompts;
    }

    /**
     * Parsing logic: Preferred Numbered List > Scene Tags > Double Newlines
     */
    _parseContent(content) {
        // 1. Scene identifiers
        if (/Scene\s+\d+/i.test(content)) {
            return content.split(/(?=Scene\s+\d+)/gi).map(p => p.trim()).filter(p => p.length > 0);
        }

        // 2. Numbered Lists (e.g. "1. Description")
        const isNumberedList = /^\d+\.\s/m.test(content);
        if (isNumberedList) {
            const prompts = [];
            const lines = content.split(/\r?\n/);
            let currentPrompt = "";

            lines.forEach(line => {
                const trimmed = line.trim();
                // Ignore separator lines
                if (trimmed.includes('---')) return;

                // Start of new numbered item
                if (/^\d+\.\s/.test(trimmed)) {
                    if (currentPrompt) prompts.push(currentPrompt);
                    currentPrompt = trimmed.replace(/^\d+\.\s/, "").trim();
                } else if (trimmed.length > 0 && !trimmed.includes('=======')) {
                    // Append continuation lines
                    currentPrompt += " " + trimmed;
                }
            });
            if (currentPrompt) prompts.push(currentPrompt);
            return prompts;
        }

        // 3. Fallback: Block paragraphs separated by empty lines
        const blocks = content.split(/\n\s*\n/);
        const validBlocks = blocks.map(p => p.trim())
            .filter(p => p.length > 0 && !p.includes('=======') && !p.includes('---'));

        if (validBlocks.length === 0 && content.trim().length > 0 && !content.includes('=======') && !content.includes('---')) {
            return [content.trim()];
        }
        return validBlocks;
    }

    /**
     * Updates status for a specific file and moves it if complete.
     */
    updateStatus(filename, status) { // status: 'completed' | 'failed' | 'skipped'
        const fileStatus = this.promptFileStatus.get(filename);
        if (!fileStatus) return;

        if (status === 'completed') fileStatus.completed++;
        if (status === 'failed') fileStatus.failed++;
        if (status === 'skipped') fileStatus.skipped++;

        this._checkAndMoveFile(filename);
    }

    /**
     * Moves the source text file to the Done folder if all prompts processed.
     */
    _checkAndMoveFile(filename) {
        const status = this.promptFileStatus.get(filename);
        if (!status) return;

        const totalProcessed = status.completed + status.failed + status.skipped;
        if (totalProcessed === status.total) {
            const sourceFile = path.join(this.promptsDir, `${filename}.txt`);
            const destFile = path.join(this.doneDir, `${filename}.txt`);

            try {
                if (fs.existsSync(sourceFile)) {
                    fs.renameSync(sourceFile, destFile);
                    console.log(`\n📦 [MOVED] ${filename}.txt -> prompts/done/`);
                }
            } catch (e) {
                console.log(`\n⚠️ Error moving ${filename}.txt: ${e.message}`);
            }
        }
    }

    /**
     * Logs a failed prompt to the global fail file.
     */
    logFailure(promptData, errorMsg = "Unknown Error") {
        const entry = `\n${"=".repeat(40)}\nPrompt #${promptData.promptIndex} (File: ${promptData.filename})\nError: ${errorMsg}\n---\n${promptData.text}\n${"=".repeat(40)}\n`;
        try {
            fs.appendFileSync(this.retryFile, entry, "utf8");
        } catch (e) {
            console.error(`Failed to write to fail log: ${e.message}`);
        }
    }
}

module.exports = PromptManager;
