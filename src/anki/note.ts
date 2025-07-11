import AnkiPlugin from 'plugin';
import {
    ANKI_PATTERN_REGEX,
    createComment,
    createTimeStampComment,
    DECK_PATTERN,
    FIELDS_PATTERN,
    LIST_SEP_REGEX,
    NOTE_DATE_COMMENT_REGEX,
    NOTE_END_COMMENT,
    NOTE_ID_COMMENT_REGEX,
    NOTE_START_COMMENT,
    TAGS_PATTERN,
} from 'regex';
import { ExportRule } from 'settings/export';
import { ImportRule } from 'settings/import';
import { formatURI } from 'format';
import { Moment } from 'moment';
import { File, NoteMatch } from './file';
import { debug } from 'common';
import { FileSystemAdapter, moment } from 'obsidian';
import { Rule } from 'settings';

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

    // Definition of the note (without generated properties)
    note: string = '';

    // User set properties
    noteType?: string;
    deck?: string;
    tags: string[] = [];
    cards: number[] = [];
    fields: Record<string, string> = {};

    // Generated properties
    id?: number;
    lastImport?: Moment;
    lastExport?: Moment;
    status: NoteStatus = NoteStatus.UNKNOWN;

    constructor(plugin: AnkiPlugin, file?: File, id?: number) {
        this.plugin = plugin;
        this.file = file;
        this.id = id;
    }

    static fromInfo(plugin: AnkiPlugin, info: AnkiNoteInfo): Note {
        const note = new Note(plugin);

        // Set normal properties
        note.id = info.noteId;
        note.noteType = info.modelName;
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

    private static fromMatch(
        plugin: AnkiPlugin,
        match: NoteMatch,
        rule: Rule
    ): Note {
        const note = new Note(plugin, match.file);

        note.id = match.id ? parseInt(match.id) : undefined;
        note.noteType = rule.noteType;

        // Set properties
        note.note = match.text;
        note.fields = match.fields ?? {};
        note.deck = match.deck;

        note.tags = (match.tags ?? '')
            .split(LIST_SEP_REGEX)
            .map((tag) => tag.trim());

        return note;
    }

    static fromImportMatch(
        plugin: AnkiPlugin,
        match: NoteMatch,
        rule: ImportRule
    ): Note {
        const note = Note.fromMatch(plugin, match, rule);

        note.lastImport = match.datetime ? moment(match.datetime) : undefined;

        return note;
    }

    static fromExportMatch(
        plugin: AnkiPlugin,
        match: NoteMatch,
        rule: ExportRule
    ) {
        const note = Note.fromMatch(plugin, match, rule);

        note.lastExport = match.datetime ? moment(match.datetime) : undefined;

        // Tags (both from rule and from file)
        if (rule.tag.enabled && !note.tags.includes(rule.tag.format)) {
            note.tags = [...note.tags, rule.tag.format];
        }

        note.status = note.id
            ? NoteStatus.EXPORT_UPDATE
            : NoteStatus.EXPORT_CREATE;

        return note;
    }

    setLink(path: string, field: string, line?: number) {
        const vault = this.plugin.app.vault.getName();
        const uri = formatURI(vault, path, line);

        this.fields[field] =
            `<a href="${uri}" class="obsidian-link">Obsidian</a>`;
    }

    text(type?: 'import' | 'export'): string {
        const beginComment = type !== 'import' ? '' : `${NOTE_START_COMMENT}`;
        const endComment = type !== 'import' ? '' : NOTE_END_COMMENT;

        const idComment = this.id
            ? `${createComment(`Note identifier: ${this.id}`)}`
            : '';

        const dt =
            type === 'import'
                ? this.lastImport
                : type === 'export'
                  ? this.lastExport
                  : undefined;
        const dtComment = type && dt ? createTimeStampComment(type, dt) : '';

        return `${beginComment}\n${this.note}\n${idComment}\n${dtComment}\n${endComment}`
            .replace('\n\n', '\n')
            .trimEnd();
    }

    setFromTemplate(template: string): boolean {
        this.note = template;

        // Replace individual {{Field}} patterns
        this.note = this.note.replace(ANKI_PATTERN_REGEX, (match, key) => {
            return key in this.fields ? this.fields[key] : match;
        });

        // Replace collective fields from {{Fields}} pattern
        const fieldsStr = Object.entries(this.fields)
            .map(([field, value]) => `${field}: ${value}`)
            .join('\n');

        this.note = this.note.replace(FIELDS_PATTERN, fieldsStr);

        // Replace {{Deck}} pattern
        if (this.deck) {
            this.note = this.note.replace(DECK_PATTERN, this.deck);
        }

        // Replace {{Tags}} pattern
        const tagsStr = this.tags.join(', ');
        this.note = this.note.replace(TAGS_PATTERN, tagsStr);

        return this.note == template;
    }

    create(
        options: AnkiAddNoteOptions = DEFAULT_NOTE_ADD_OPTIONS
    ): AnkiAddNote {
        return {
            deckName: this.deck!,
            modelName: this.noteType!,
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
