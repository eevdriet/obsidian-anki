import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import AnkiPlugin from 'plugin';
import { File, FileStatus } from './file';
import { Note } from './note';
import micromatch from 'micromatch';
import { debug } from 'common';

export default class NoteScanner {
    plugin: AnkiPlugin;
    app: App;
    vault: string;

    files: Map<string, File> = new Map();
    notesWithId: Map<number, Note> = new Map();
    notesWithoutId: Note[] = [];
    ruleFiles: Map<string, File[]> = new Map();

    constructor(plugin: AnkiPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.vault = this.app.vault.getName();
    }

    protected async scanVault() {
        debug('Scan vault (begin)');

        this.files.clear();
        this.notesWithId.clear();
        this.notesWithoutId = [];

        const allFiles = this.findVaultNoteFiles();
        const processed = new Set();

        for (const [tfiles, rule] of allFiles) {
            for (const tfile of tfiles) {
                // Skip the file if it has already been processed
                const path = tfile.path;
                if (processed.has(path)) {
                    continue;
                }

                // Create file if it doesn't exist already
                let file = this.files.get(path);
                if (!file) {
                    // Collect file statistics
                    const text = await this.app.vault.read(tfile);
                    const cache = this.app.metadataCache.getFileCache(tfile);

                    // Create file and start scanning for notes
                    file = new File(this.plugin, tfile, text, cache);
                }

                // Attach the file to the rule it was found from
                if (rule) {
                    this.ruleFiles.set(rule, [
                        ...(this.ruleFiles.get(rule) ?? []),
                        file,
                    ]);
                }

                processed.add(path);

                // Store the file and scan it for notes
                this.files.set(path, file);

                // Determine the file status based on existing cache
                let currHash = file.hash;

                if (path in this.plugin.noteFiles) {
                    file.status = FileStatus.UNALTERED;

                    const prevHash = this.plugin.noteFiles[path];
                    if (prevHash !== currHash) {
                        file.status = FileStatus.ALTERED;
                    }
                }

                // Store the file hash if it contains notes
                if (Object.keys(file.notes).length > 0) {
                    this.plugin.noteFiles[path] = currHash;
                }
            }
        }

        debug('Scan vault (end)');
        this.plugin.save();
    }

    protected async writeFiles(): Promise<void> {
        const modifiedFiles = Array.from(this.files.values()).filter(
            (file) => file.status === FileStatus.MODIFIED
        );

        for (const file of modifiedFiles) {
            await this.app.vault.modify(file.tfile, file.text);
        }
    }

    private findFilesFromSource(
        file: TAbstractFile | string,
        patterns: Array<string> = [],
        cache: Record<string, TFile[]>
    ): Array<TFile> {
        // Make sure the file exists and is valid within the vault
        let source: TAbstractFile | string | null = file;

        if (
            file instanceof TAbstractFile &&
            !this.app.vault.getAbstractFileByPath(file.path)
        ) {
            return [];
        }

        // Transform a string source into a file and verify its validity
        if (typeof file === 'string') {
            source = this.app.vault.getAbstractFileByPath(file);
        }

        if (!source || typeof source === 'string') {
            return [];
        }

        // Recursively find all files by going through the folders from the source
        const dfs = (file: TAbstractFile): TFile[] => {
            // Check if query was run before
            if (file.path in cache) {
                return cache[file.path];
            }

            // Add files directly and stop recursing
            let result: TFile[] = [];

            if (file instanceof TFile) {
                result = [file];
            }

            // Recursively add files in child folders
            else if (file instanceof TFolder) {
                file.children.forEach((child) => {
                    result.push(...dfs(child));
                });
            }

            cache[file.path] = result;
            return result;
        };

        let files = dfs(source);

        // Filter on any specified patterns
        if (patterns.length > 0) {
            files = files.filter((tfile) =>
                micromatch.isMatch(tfile.path, patterns)
            );
        }

        return files;
    }

    private findVaultNoteFiles(): [TFile[], string?][] {
        const result: [TFile[], string?][] = [];

        const cache: Record<string, TFile[]> = {};

        // Cached files
        for (const path of Object.keys(this.plugin.noteFiles)) {
            const files = this.findFilesFromSource(path, [], cache);
            result.push([files]);
        }

        // Import files
        for (const [name, rule] of Object.entries(
            this.plugin.settings.import.rules
        )) {
            let files: TFile[] = [];

            if (rule.type === 'file') {
                files = this.findFilesFromSource(rule.file.path, [], cache);
            }

            result.push([files, `import-${name}`]);
        }

        // Export files
        for (const [name, rule] of Object.entries(
            this.plugin.settings.export.rules
        )) {
            let { folder, patterns } = rule.source;
            folder = folder === '' ? '/' : folder;

            const files = this.findFilesFromSource(folder, patterns, cache);
            result.push([files, `export-${name}`]);
        }

        return result;
    }
}
