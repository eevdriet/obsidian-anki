import { Notice } from 'obsidian';
import AnkiPlugin from 'plugin';
import * as AnkiConnect from 'anki/connect';
import { NoteStatus, Note } from 'anki/note';
import ExportFormatter from 'format/export';
import NoteScanner from './scanner';
import { errorMessage, successMessage, debug, message } from 'common';

export default class Exporter extends NoteScanner {
    formatter: ExportFormatter;
    ruleNotes: Map<string, Note[]> = new Map();

    constructor(plugin: AnkiPlugin) {
        super(plugin);

        this.formatter = new ExportFormatter(this.vault);
    }

    public async export(): Promise<void> {
        message('Exporting...');

        // Determine which notes can be exported to Anki
        await this.scanVault();
        this.findExportNotes();

        const allNotes = [...this.notesWithId.values(), ...this.notesWithoutId];
        if (allNotes.length === 0) {
            return;
        }

        // Format the notes to a suitable format for Anki
        const formattedNotes = allNotes.map((note) =>
            this.formatter.format(note)
        );

        try {
            // Perform Anki actions on the export notes
            await this.createDecks();
            await this.createNotes(formattedNotes);
            await this.updateNotes(formattedNotes);
            await this.deleteNotes(formattedNotes);

            // Perform Obsidian actions
            await this.writeFiles();

            successMessage('Export');
        } catch (error) {
            errorMessage('Export');
        }
    }

    private findExportNotes() {
        debug('Find export notes (begin)');
        const rules = Object.entries(this.plugin.settings.export.rules);

        for (let [name, rule] of rules) {
            // Only find notes from enabled files
            if (!rule.enabled) {
                continue;
            }

            // Find all files from the current rule
            name = `export-${name}`;

            const files = this.ruleFiles.get(name) ?? [];
            for (const file of files) {
                // Find all notes from the current file
                const notes = file.findExportNotes(rule);

                for (const note of notes) {
                    if (note.id) {
                        this.notesWithId.set(note.id, note);
                    } else {
                        this.notesWithoutId.push(note);
                    }
                }
            }
        }

        debug('Find export notes (end)');
        debug('Notes', this.notesWithId, this.notesWithoutId);
    }

    private async createDecks() {
        const decks: Set<string> = new Set();
        const notes = this.notesWithoutId.concat(...this.notesWithId.values());

        for (const note of notes) {
            if (note.deck) {
                decks.add(note.deck);
                continue;
            }
        }

        await AnkiConnect.createDecks(...decks);
    }

    private async createNotes(notes: Note[]) {
        // Determine which notes to add to Anki
        const notesToCreate = notes
            .filter((note) => note.status === NoteStatus.EXPORT_CREATE)
            .filter((note) => note.deck && note.type);

        if (notesToCreate.length === 0) {
            return;
        }

        // Format the notes to a suitable format for Anki
        notesToCreate.forEach((note) => this.formatter.format(note));

        // Determine which notes could be succesfully created
        const identifiers = await AnkiConnect.createNotes(
            ...notesToCreate.map((note) => note.create())
        );

        notesToCreate.forEach((note, idx) => {
            const id = identifiers[idx];
            if (!id) {
                return;
            }

            note.setId(id, true);
            this.plugin.notes.add(id);
        });

        this.plugin.save();
        return;
    }

    private async updateNotes(notes: Note[]) {
        const notesToUpdate = notes
            .filter((note) => note.status === NoteStatus.EXPORT_UPDATE)
            .map((note) => note.update());

        // Modify the notes in Anki
        await AnkiConnect.updateNotes(...notesToUpdate);
    }

    private async deleteNotes(notes: Note[]) {
        // Determine which notes to add to Anki
        const notesToDelete = notes
            .filter((note) => note.status === NoteStatus.EXPORT_DELETE)
            .map((note) => note.id!);

        // Delete the notes in Anki
        const response = await AnkiConnect.deleteNotes(...notesToDelete);

        // Delete the notes in Obsidian
        for (const file of this.files.values()) {
        }
    }
}
