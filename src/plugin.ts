import { ANKI_ICON, debug } from 'common';
import Exporter from 'anki/export';
import Importer from 'anki/import';
import { addIcon, Plugin as ObsidianPlugin, TFile } from 'obsidian';

import { AnkiPluginSettings, DEFAULT_SETTINGS } from 'settings';
import AnkiPluginSettingTab from 'settings/tab';
import { sync } from 'anki/sync';
import { File } from 'anki/file';

export default class AnkiPlugin extends ObsidianPlugin {
    noteTypes: string[] = [];
    decks: string[] = [];
    fields: Record<string, string[]> = {};
    cards: Record<string, string[]> = {};
    noteFiles: Record<string, string> = {};
    notes: Set<number> = new Set();

    settings: AnkiPluginSettings;
    importer: Importer;
    exporter: Exporter;

    async onload(): Promise<void> {
        debug('Loading...');
        addIcon('anki', ANKI_ICON);

        await this.loadSettings();
        this.addCommands();
        this.registerEvents();

        this.addSettingTab(new AnkiPluginSettingTab(this.app, this));
        this.importer = new Importer(this);
        this.exporter = new Exporter(this);

        // Perform actions on start up if configured
        if (this.settings.onload.sync) {
            sync(this);
        }

        if (this.settings.onload.import) {
            this.importer.import();
        }

        if (this.settings.onload.export) {
            this.exporter.export();
        }

        debug('Loaded!');
    }

    async onunload() {
        debug('Unloading...');

        await this.save();

        debug('Unloaded!');
    }

    public async save(): Promise<void> {
        const settings: Record<string, any> = { ...this.settings };
        const data = {
            settings: settings,
            noteTypes: this.noteTypes,
            decks: this.decks,
            fields: this.fields,
            cards: this.cards,
            noteFiles: this.noteFiles,
            notes: [...this.notes],
        };

        await this.saveData(data);
    }

    async loadSettings(): Promise<void> {
        // Set the saved data
        let data = await this.loadData();

        this.cards = data.cards;
        this.decks = data.decks;
        this.fields = data.fields;
        this.noteFiles = data.noteFiles;
        this.noteTypes = data.noteTypes;
        this.notes = data.notes;

        this.notes = new Set(data.notes);
        this.settings = data.settings ?? DEFAULT_SETTINGS;
    }

    private addCommands(): void {
        this.addCommand({
            id: 'anki-import-notes',
            name: 'Import',
            callback: async () => {
                this.importer.import();
            },
        });
        this.addCommand({
            id: 'anki-export-notes',
            name: 'Export',
            callback: async () => {
                this.exporter.export();
            },
        });
        this.addCommand({
            id: 'anki-sync-data',
            name: 'Sync',
            callback: async () => {
                sync(this);
            },
        });
    }

    private registerEvents(): void {
        this.registerEvent(
            this.app.vault.on('rename', async (tfile, oldPath) => {
                // Only act on file name changes
                if (!(tfile instanceof TFile)) {
                    return;
                }

                // Update plugin hashes if file contains notes
                if (oldPath in this.noteFiles) {
                    const newPath = tfile.path;
                    const text = await this.app.vault.read(tfile);
                    const hash = File.hash(text);

                    delete this.noteFiles[oldPath];
                    this.noteFiles[newPath] = hash;
                    this.save();
                }
            })
        );
    }
}
