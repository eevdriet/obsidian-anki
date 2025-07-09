import { File } from './file';
import { moment } from 'obsidian';
import AnkiPlugin from 'plugin';
import ImportFormatter from 'format/import';
import * as AnkiConnect from 'anki/connect';
import { Note, NoteStatus } from './note';
import { escapeFileName, formatTemplate } from 'format';
import NoteScanner from './scanner';
import { ImportRule } from 'settings/import';
import { debug, errorMessage, message, successMessage } from 'common';
import { CardInfo } from './card';

export default class Importer extends NoteScanner {
    formatter: ImportFormatter;

    ankiNotes: Map<number, Note> = new Map();
    noteRules: Map<number, ImportRule> = new Map();
    cardsInfo: Map<number, CardInfo> = new Map();

    constructor(plugin: AnkiPlugin) {
        super(plugin);
        this.formatter = new ImportFormatter(this.app);
    }

    public async import(): Promise<void> {
        message('Importing...');

        // Determine which notes can be imported to Anki
        await this.scanVault();
        await this.findImportNotes();

        const allNotes = [...this.ankiNotes.values()];
        if (allNotes.length === 0) {
            debug('No notes imported from Anki');
            return;
        }

        // Format the notes to a suitable format for Obsidian and retrieve media
        const formattedNotes = [];
        for (const note of allNotes) {
            const formatted = await this.formatter.format(note);
            formattedNotes.push(formatted);
        }
        const media = this.formatter.media;

        console.info('Formatted notes', formattedNotes);

        try {
            // Perform Anki actions
            await this.retrieveMedia(media);

            // Perform Obsidian actions
            await this.createNotes(formattedNotes);
            await this.updateNotes(formattedNotes);
            await this.writeFiles();

            successMessage('Import');
        } catch (error) {
            errorMessage('Import');
        }
    }

    private async findImportNotes() {
        this.ankiNotes.clear();

        debug('Find import notes (start)');
        const rules = Object.values(this.plugin.settings.import.rules).filter(
            (rule) => rule.enabled
        );

        // Create the requests to get the notes from Anki
        const responses = rules.map(async (rule) => {
            const typeArg = `note:"${rule.noteType}"`;

            let query = rule.query;
            if (!query.includes(typeArg)) {
                query = query !== '' ? `(${query}) AND ${typeArg}` : typeArg;
            }

            return AnkiConnect.getNotes(query);
        });

        // Parse the responses for each rules
        const allAnkiNotes = await Promise.all(responses);

        for (let idx = 0; idx < rules.length; idx++) {
            const rule = rules[idx];
            const ankiNotes = allAnkiNotes[idx];

            // If all notes should be placed in the same file, set that file
            let ruleFile: File | undefined;
            if (rule.type === 'file') {
                ruleFile = await this.findFile(rule.file.path, rule);
                const notes = ruleFile.findImportNotes(rule);

                for (const note of notes) {
                    if (note.id) {
                        this.notesWithId.set(note.id, note);
                    } else {
                        this.notesWithoutId.push(note);
                    }
                }
            }

            for (const info of ankiNotes) {
                // Create an Obsidian note from the Anki info
                const note = Note.fromInfo(this.plugin, info);
                if (!note.id) {
                    continue;
                }

                // Determine whether to update, append or do nothing with the note
                const noteExists = this.notesWithId.has(note.id);
                const action = rule.existingAction;

                if (noteExists && action === 'update') {
                    note.status = NoteStatus.IMPORT_UPDATE;
                    note.lastImport = this.notesWithId.get(note.id)!.lastImport;
                } else if (!noteExists || action === 'append') {
                    note.status = NoteStatus.IMPORT_CREATE;
                }

                // If all notes should be placed in their own file, set that file
                let file = ruleFile;
                if (file === undefined) {
                    file = await this.findFileInFolder(rule, note);
                }

                if (file === undefined) {
                    continue;
                }

                if (file !== ruleFile) {
                    const notes = file.findImportNotes(rule);

                    for (const note of notes) {
                        if (note.id) {
                            this.notesWithId.set(note.id, note);
                        } else {
                            this.notesWithoutId.push(note);
                        }
                    }
                }

                // Register note to import
                note.file = file;

                this.ankiNotes.set(note.id, note);
                this.noteRules.set(note.id, rule);
            }
        }

        // Retrieve cards info and set remaining note properties
        await this.findImportCards();

        for (const [id, note] of this.ankiNotes.entries()) {
            const rule = this.noteRules.get(id);
            if (!rule) {
                continue;
            }

            // Set the deck of the note if all its cards are placed in a single deck
            const decks = note.cards.map(
                (card, idx) => this.cardsInfo.get(card)?.deckName ?? `${idx}`
            );

            if (decks.every((deck) => deck === decks[0])) {
                note.deck = decks[0];
            }

            note.setFromTemplate(rule.template);
        }

        debug('Find import notes (end)');
    }

    private async findImportCards() {
        const cards = [
            ...Array.from(this.ankiNotes.values()).flatMap(
                (note) => note.cards
            ),
        ];

        const cardsInfo = await AnkiConnect.getCardsInfo(...cards);
        for (const info of cardsInfo) {
            this.cardsInfo.set(info.cardId, info);
        }
    }

    private async retrieveMedia(media: Map<string, string>) {
        // Determine which media files should be retrieved and split paths
        const filteredMedia = [...media.entries()].filter(
            ([_, path]) => !this.app.vault.getAbstractFileByPath(path)
        );

        const mediaPaths = filteredMedia.map(([media, _]) => media);
        const attachPaths = filteredMedia.map(([_, attach]) => attach);

        // Retrieve the media contents from Anki
        const contents = await AnkiConnect.retrieveMedia(...mediaPaths);

        for (let idx = 0; idx < filteredMedia.length; idx++) {
            // Determine Obsidian media path and contents
            const path = attachPaths[idx];
            const content = contents[idx];

            // Write the media into the vault
            const buffer = Buffer.from(content, 'base64');
            await this.app.vault.createBinary(path, buffer);
        }
    }

    private async createNotes(ankiNotes: Note[]) {
        // Determine which notes to add to Obsidian
        const notesToCreate = ankiNotes.filter(
            (note) => note.status === NoteStatus.IMPORT_CREATE
        );
        if (notesToCreate.length === 0) {
            return;
        }

        debug('Create import notes (start)', notesToCreate);

        notesToCreate.forEach((note) => {
            if (!note.file || !note.id) {
                debug(`No file or id for ${note}`);
                return;
            }

            const rule = this.noteRules.get(note.id);
            if (!rule) {
                debug(`No rule found for note ${note.id}`);
                return;
            }

            // Find where to insert the note within its file
            let pos;

            if (rule.type === 'file') {
                const { enabled, format } = rule.insertAfter;
                if (enabled) {
                    // Insert after where the format is first found
                    const idx = note.file.text.indexOf(format);
                    if (idx >= 0) {
                        pos = idx;
                    }
                }
            }

            // Insert the note into its file
            note.lastImport = moment();

            const text = `${note.text('import').trimEnd()}\n\n`;
            note.file?.insert(text, pos);

            this.plugin.notes.add(note.id);
        });

        await this.plugin.save();
        debug('Create import notes (end)');
    }

    private async updateNotes(ankiNotes: Note[]) {
        // Determine which notes to update to Obsidian
        const notesToUpdate = ankiNotes.filter(
            (note) => note.status === NoteStatus.IMPORT_UPDATE
        );
        if (notesToUpdate.length === 0) {
            return;
        }

        debug('Update import notes (start)', notesToUpdate);

        for (const ankiNote of notesToUpdate) {
            // Determine which Obsidian note corresponds to an (updated) Anki note
            if (!ankiNote.id) {
                return;
            }

            const note = this.notesWithId.get(ankiNote.id);
            if (!note || !note.id) {
                return;
            }

            const rule = this.noteRules.get(note.id);
            if (!rule) {
                debug(`No rule found for note ${note.id}`);
                return;
            }

            // Replace the contents of the note
            const noteBefore = note.text('import');

            note.fields = { ...ankiNote.fields };
            note.setFromTemplate(rule.template);
            note.lastImport = moment();

            const noteAfter = note.text('import');

            // Replace the note within the file
            note.file?.replace(noteBefore, noteAfter);
            this.plugin.notes.add(note.id!);
        }

        await this.plugin.save();
        debug('Update import notes (end)');
    }

    private async findFile(path: string, rule: ImportRule): Promise<File> {
        // Create the file if not found already
        if (!this.files.has(path)) {
            let tfile = this.app.vault.getFileByPath(path);
            let text = '';

            // Create new empty file
            if (!tfile) {
                tfile = await this.app.vault.create(path, text);
            }

            // Read from existing
            else {
                text = await this.app.vault.read(tfile);
            }

            const cache = this.app.metadataCache.getFileCache(tfile);

            const file = new File(this.plugin, tfile, text, cache);
            this.files.set(path, file);
        }

        const file = this.files.get(path)!;

        // Add or set a file tag to the frontmatter if enabled
        const { enabled: tagEnabled, format: tagFormat } = rule.tag;

        if (tagEnabled) {
            await this.app.fileManager.processFrontMatter(
                file.tfile,
                (frontmatter) => {
                    if (!frontmatter.tags) {
                        frontmatter.tags = [];
                    }
                    if (!frontmatter.tags.includes(tagFormat)) {
                        frontmatter.tags = [...frontmatter.tags, tagFormat];
                    }
                }
            );
        }

        // Attach the note
        return file;
    }

    private async findFileInFolder(
        rule: ImportRule,
        note: Note
    ): Promise<File> {
        let path = rule.folder.path;

        // Create the folder the note should belong to if it doesn't exist
        let tfolder = this.app.vault.getFolderByPath(path);
        if (!tfolder) {
            tfolder = await this.app.vault.createFolder(path);
        }

        // Derive the file path from the folder and file name format
        let fileName = formatTemplate(rule.folder.fileFormat, note);
        fileName = escapeFileName(fileName);
        if (!fileName.endsWith('.md')) {
            fileName += '.md';
        }
        path = `${tfolder.path}/${fileName}`;

        // Attach the note to its own file
        return await this.findFile(path, rule);
    }
}
