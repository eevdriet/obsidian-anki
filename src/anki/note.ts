import AnkiPlugin from 'plugin';
import {
    ANKI_PATTERN_REGEX,
    DECK_PATTERN,
    FIELDS_PATTERN,
    NOTE_ID_COMMENT_REGEX,
    TAGS_PATTERN,
} from 'regex';
import { ExportRule } from 'settings/export';
import { ImportRule } from 'settings/import';
import { formatURI } from 'format';
import { File } from './file';
import { debug } from 'common';

export enum NoteStatus {
    // Export states
    EXPORT_CREATE = 'export-create',
    EXPORT_UPDATE = 'export-update',
    EXPORT_DELETE = 'export-delete',

    // Import states
    IMPORT_IGNORE = 'import-ignore',
    IMPORT_CREATE = 'import-create',
    IMPORT_UPDATE = 'import-update',

    UNKNOWN = 'unknown',
}

export class Note {
    plugin: AnkiPlugin;
    file?: File;

    id?: number;
    type?: string;
    deck?: string;
    tags: string[] = [];
    cards: number[] = [];
    fields: Record<string, string> = {};

    text: string = '';
    status: NoteStatus = NoteStatus.UNKNOWN;

    constructor(plugin: AnkiPlugin, file?: File, id?: number) {
        this.plugin = plugin;
        this.file = file;
        this.id = id;
    }

    static fromInfo(plugin: AnkiPlugin, info: AnkiNoteInfo): Note {
        const note = new Note(plugin);

        note.setId(info.noteId);

        // Set normal properties
        note.type = info.modelName;
        note.tags = info.tags;
        note.cards = info.cards;

        // Set the fields in the order they appear in Anki
        const fieldEntries = Object.entries(info.fields);
        fieldEntries.sort(
            ([_1, { order: order1 }], [_2, { order: order2 }]) =>
                order1 - order2
        );

        note.fields = Object.fromEntries(
            fieldEntries.map(([field, value]) => [field, value.value])
        );

        return note;
    }

    setLink(path: string, field: string) {
        const vault = this.plugin.app.vault.getName();
        const uri = formatURI(vault, path);

        this.fields[field] =
            `<a href="${uri}" class="obsidian-link">Obsidian</a>`;
    }

    setId(id: number | undefined, withComment: boolean = false): void {
        // Set the identifier
        this.id = id;

        if (!this.file || !withComment) {
            return;
        }

        const noteBefore = this.text;
        let noteAfter: string;

        if (NOTE_ID_COMMENT_REGEX.test(this.text)) {
            // Replace the ID within the comment
            noteAfter = noteBefore.replace(
                NOTE_ID_COMMENT_REGEX,
                (match, oldId) => match.replace(oldId, String(this.id))
            );
        } else {
            // Append the ID comment to the end of the note
            noteAfter = `${noteBefore.trimEnd()}\n<!-- Note ID: ${this.id} -->`;
        }

        if (noteBefore != noteAfter) {
            this.file.replace(noteBefore, noteAfter);
        }
    }

    setTextFromTemplate(template: string): boolean {
        this.text = template;

        // Replace individual {{Field}} patterns
        this.text = this.text.replace(ANKI_PATTERN_REGEX, (match, key) => {
            return key in this.fields ? this.fields[key] : match;
        });

        // Replace collective fields from {{Fields}} pattern
        const fieldsStr = Object.entries(this.fields)
            .map(([field, value]) => `${field}: ${value}`)
            .join('\n');

        this.text = this.text.replace(FIELDS_PATTERN, fieldsStr);

        // Replace {{Deck}} pattern
        if (this.deck) {
            this.text = this.text.replace(DECK_PATTERN, this.deck);
        }

        // Replace {{Tags}} pattern
        const tagsStr = this.tags.join(', ');
        this.text = this.text.replace(TAGS_PATTERN, tagsStr);

        return this.text == template;
    }

    create(
        options: AnkiAddNoteOptions = DEFAULT_NOTE_ADD_OPTIONS
    ): AnkiAddNote {
        return {
            deckName: this.deck!,
            modelName: this.type!,
            fields: this.fields,
            tags: this.tags,
            options,
        };
    }

    update(): AnkiUpdateNote {
        const result: AnkiUpdateNote = {
            id: this.id!,
            fields: this.fields,
        };

        // Only add tags if they are set: existing tags are overridden
        if (this.tags.length > 0) {
            result.tags = this.tags;
        }

        return result;
    }

    clone(): Note {
        const result = new Note(this.plugin, this.file, this.id);
        Object.assign(result, this);

        result.cards = [...this.cards];
        result.tags = [...this.tags];
        result.fields = { ...this.fields };

        return result;
    }
}

export type AnkiNoteInfo = {
    noteId: number;
    profile: string;
    modelName: string;
    tags: string[];
    fields: Record<string, { value: string; order: number }>;
    mod: number;
    cards: number[];
};

// Adding
export interface AnkiAddNote {
    deckName: string;
    modelName: string;
    fields: Record<string, string>;

    tags?: string[];

    options?: AnkiAddNoteOptions;
}

export interface AnkiAddNoteOptions {
    allowDuplicate: boolean;
    duplicateScope?: string;
    duplicateScopeOptions?: {
        deckName: string;
        checkChildren: boolean;
        checkAllModels: boolean;
    };
}

export const DEFAULT_NOTE_ADD_OPTIONS: AnkiAddNoteOptions = {
    allowDuplicate: false,
    duplicateScope: 'deck',
};

// Updating
export interface AnkiUpdateNote {
    id: number;
    fields: Record<string, string>;

    tags?: string[];
}

export interface AnkiExportNote extends Note {
    rule: ExportRule;
}

export interface AnkiImportNote extends Note {
    rule: ImportRule;
}
