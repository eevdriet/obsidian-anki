import AnkiPlugin from 'plugin';
import * as AnkiConnect from 'anki/connect';
import { NoteStatus, Note } from 'anki/note';
import { moment } from 'obsidian';
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
            debug('Rule', name, rule, files);

            for (const file of files) {
                // Find all notes from the current file
                const notes = file.findExportNotes(rule);

                if (notes.length > 0) {
                    debug(file.tfile.name, notes);
                }

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
        debug('Create export notes (start)');

        // Determine which notes to add to Anki
        const notesToCreate = notes
            .filter((note) => note.status === NoteStatus.EXPORT_CREATE)
            .filter((note) => note.deck && note.noteType);
        if (notesToCreate.length === 0) {
            return;
        }

        // Format the notes to a suitable format for Anki
        const ankiNotes = notesToCreate
            .map((note) => this.formatter.format(note))
            .map((note) => note.create());

        // Determine which notes could be succesfully created
        const identifiers = await AnkiConnect.createNotes(...ankiNotes);

        notesToCreate.forEach((note, idx) => {
            const id = identifiers[idx];
            if (!id) {
                return;
            }

            // Replace the contents of the note
            const noteBefore = note.text('export');

            note.id = id;
            note.lastExport = moment();

            const noteAfter = note.text('export');

            // Replace the note within the file
            note.file?.replace(noteBefore, noteAfter);
            this.plugin.notes.add(id);
        });

        this.plugin.save();
        debug('Create export notes (end)');
    }

    private async updateNotes(notes: Note[]) {
        debug('Update export notes (start)');

        const notesToUpdate = notes.filter(
            (note) => note.id && note.status === NoteStatus.EXPORT_UPDATE
        );
        if (notesToUpdate.length === 0) {
            return;
        }

        // Update the notes in Obsidian
        notesToUpdate.forEach((note) => {
            // Replace the contents of the note
            const noteBefore = note.text('export');

            note.lastExport = moment();

            const noteAfter = note.text('export');

            // Replace the note within the file
            note.file?.replace(noteBefore, noteAfter);
            this.plugin.notes.add(note.id!);
        });

        this.plugin.save();

        // Update the notes in Anki
        const ankiNotes = notesToUpdate
            .map((note) => this.formatter.format(note))
            .map((note) => note.update());

        await AnkiConnect.updateNotes(...ankiNotes);
        debug('Update export notes (end)');
    }

    private async deleteNotes(notes: Note[]) {
        // Find out what notes to delete
        const notesToDelete = notes.filter(
            (note) => note.id && note.status === NoteStatus.EXPORT_DELETE
        );

        // Delete the notes in Obsidian
        notesToDelete.forEach((note) => {
            note.file?.replace(note.text(), '');
            this.plugin.notes.delete(note.id!);
        });

        this.plugin.save();

        // Delete the notes in Anki
        await AnkiConnect.deleteNotes(...notesToDelete.map((note) => note.id!));
    }
}
