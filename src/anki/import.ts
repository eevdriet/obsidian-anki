import { File } from './file';
import { moment } from 'obsidian';
import AnkiPlugin from 'plugin';
import ImportFormatter from 'format/import';
import * as AnkiConnect from 'anki/connect';
import { Note, NoteStatus } from './note';
import { escapeFileName, formatTemplate } from 'format';
import NoteScanner from './scanner';
import { ImportRule } from 'settings/import';
import {
    NOTE_START_COMMENT,
    NOTE_END_COMMENT,
    createComment,
    NOTE_DATE_COMMENT_REGEX,
    createTimeStampComment,
} from 'regex';
import { debug, errorMessage, message, successMessage } from 'common';
import { CardInfo } from './card';

export default class Importer extends NoteScanner {
    formatter: ImportFormatter;

    ankiNotes: Map<number, Note> = new Map();
    noteRules: Map<number, ImportRule> = new Map();
    cardsInfo: Map<number, CardInfo> = new Map();

    constructor(plugin: AnkiPlugin) {
        super(plugin);
        this.formatter = new ImportFormatter(this.vault);
    }

    public async import(): Promise<void> {
        message('Importing...');

        try {
            // Determine which notes can be imported to Anki
            await this.scanVault();
            await this.findImportNotes();

            const allNotes = [...this.ankiNotes.values()].map((note) =>
                this.formatter.format(note)
            );
            if (allNotes.length === 0) {
                debug('No notes imported from Anki');
                return;
            }

            // Perform Obsidian actions
            debug('Create import notes (start)');
            await this.createNotes(allNotes);
            debug('Create import notes (end)');

            debug('Update import notes (start)');
            await this.updateNotes(allNotes);
            debug('Update import notes (end)');

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

                console.info('File', ruleFile.tfile.name, notes);

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
        debug('Notes', this.ankiNotes, this.notesWithId);
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

    private async createNotes(ankiNotes: Note[]) {
        // Determine which notes to add to Obsidian
        const notesToCreate = ankiNotes.filter(
            (note) => note.status === NoteStatus.IMPORT_CREATE
        );
        if (notesToCreate.length === 0) {
            return;
        }

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
            note.file?.insert(note.text('import'), pos);
            this.plugin.notes.add(note.id);
        });

        await this.plugin.save();
    }

    private async updateNotes(ankiNotes: Note[]) {
        // Determine which notes to update to Obsidian
        const notesToUpdate = ankiNotes.filter(
            (note) => note.status === NoteStatus.IMPORT_UPDATE
        );
        if (notesToUpdate.length === 0) {
            return;
        }
        console.log(
            'Update notes',
            notesToUpdate.map((note) => note.clone())
        );

        for (const ankiNote of notesToUpdate) {
            // Determine which Obsidian note corresponds to an (updated) Anki note
            if (!ankiNote.id) {
                return;
            }

            const note = this.notesWithId.get(ankiNote.id);
            if (!note) {
                return;
            }

            // Replace the contents of the note
            const noteBefore = note.text('import');

            note.note = ankiNote.note;
            note.lastImport = moment();

            const noteAfter = note.text('import');

            // Replace the note within the file
            note.file?.replace(noteBefore, noteAfter);
            this.plugin.notes.add(note.id!);
        }

        await this.plugin.save();
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
