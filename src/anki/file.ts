import { CachedMetadata, TFile } from 'obsidian';
import { Note, NoteStatus } from './note';
import AnkiPlugin from 'plugin';
import {
    ANKI_FIELD_REGEX as ANKI_PATTERN_REGEX,
    createFieldRegex,
    createFieldsRegex,
    LIST_SEP_REGEX,
    ID_REGEX,
    TEMPLATE_PATTERN_REGEXES,
    NOTE_ID_COMMENT_REGEX,
    NOTE_CARDS_COMMENT_REGEX,
    NOTE_TAGS_COMMENT_REGEX,
    NOTE_DECK_COMMENT_REGEX,
    createFileDeckCommentRegex,
    createFileTagsCommentRegex,
    NOTE_START_COMMENT,
    NOTE_END_COMMENT,
} from 'regex';
import * as CryptoJS from 'crypto-js';
import { Span, MultiSpan } from './span';
import { ExportRule } from 'settings/export';
import { debug, TEMPLATE_FIELDS as TEMPLATE_PATTERNS } from 'common';
import { escapeField } from 'format';
import { ImportRule } from 'settings/import';

export enum FileStatus {
    // File not yet in file cache, should contain new notes
    NEW,

    // File already in file cache, unaltered from last seen
    UNALTERED,

    // File already in file cache, altered from last seen
    ALTERED,

    // Contents of the file have been modified, write back to system
    MODIFIED,
}

export type MatchResult = {
    result: RegExpMatchArray;
    fields: Record<string, string>;

    id?: string;
    deck?: string;
    cards?: string;
    tags?: string;
};

export class File {
    plugin: AnkiPlugin;

    tfile: TFile;
    text: string;
    cache: CachedMetadata | null;
    status: FileStatus;

    notes: Record<number, Note> = {};
    decks: [number, string][];
    tags: [number, string][];
    searched: MultiSpan;

    constructor(
        plugin: AnkiPlugin,
        tfile: TFile,
        text: string,
        cache: CachedMetadata | null,
        status: FileStatus = FileStatus.NEW
    ) {
        this.plugin = plugin;
        this.tfile = tfile;
        this.text = text;
        this.cache = cache;
        this.status = status;

        this.searched = new MultiSpan();

        // Find all deck / tags comments within the file
        const { fileDeckComment, fileTagsComment } =
            this.plugin.settings.export;

        const deckRegex = createFileDeckCommentRegex(fileDeckComment);
        this.decks = this.matchPositions(deckRegex);

        const tagsRegex = createFileTagsCommentRegex(fileTagsComment);
        this.tags = this.matchPositions(tagsRegex);
    }

    public scan(): void {
        const noteIds = [...this.text.matchAll(ID_REGEX)].map((match) =>
            parseInt(match[1])
        );

        for (const noteId of noteIds) {
            if (!noteId) {
                continue;
            }
        }
    }

    public static hash(text: string): string {
        return CryptoJS.SHA256(text).toString(CryptoJS.enc.Hex);
    }

    public get hash() {
        return File.hash(this.text);
    }

    public replace(oldText: string, newText: string) {
        if (!this.text.includes(oldText)) {
            return;
        }

        this.text = this.text.replace(oldText, newText);
        this.status = FileStatus.MODIFIED;
    }

    public insert(text: string, pos?: number) {
        const start = this.text.substring(0, pos);
        const end = pos ? this.text.substring(pos) : '';

        this.text = start + text + end;
        this.status = FileStatus.MODIFIED;
    }

    public findImportNotes(rule: ImportRule): Note[] {
        const regex = new RegExp(
            `^${NOTE_START_COMMENT}\\n(?<text>(?:.|\\n)+?)${NOTE_ID_COMMENT_REGEX.source}\\n?${NOTE_END_COMMENT}`,
            'gmi'
        );
        return this.matchAll(regex).map((match) => {
            const { id, text } = match.groups!;

            const note = new Note(this.plugin, this, Number(id));
            note.text = text;

            return note;
        });
    }

    public findExportNotes(rule: ExportRule): Note[] {
        const notes: Note[] = [];

        // Find all notes that match the rule
        let matches: MatchResult[] = [];

        if (rule.type === 'regex') {
            matches = this.matchRegex(rule);
        } else if (rule.type === 'template') {
            matches = this.matchTemplate(rule);
        }

        if (matches.length === 0) {
            return [];
        }

        for (let match of matches) {
            // Update part of the file that has been searched
            const span = Span.fromMatch(match.result);
            this.searched.merge(span);

            const pos = match.result.index!;

            // Retrieve the note from cache or create a new one
            const id = match.id ? parseInt(match.id) : undefined;

            let note = new Note(this.plugin, this, id);
            if (id && id in this.notes) {
                note = this.notes[id];
            }

            // Set properties
            note.type = rule.noteType;
            note.text = match.result[0];

            note.fields = match.fields;
            note.deck =
                match.deck ??
                this.findMatch(pos, this.decks) ??
                rule.regex.deck;

            note.tags = (match.tags ?? this.findMatch(pos, this.tags) ?? '')
                .split(LIST_SEP_REGEX)
                .map((tag) => tag.trim());

            if (rule.link.enabled && rule.link.field) {
                note.setLink(this.tfile.path, rule.link.field);
            }

            note.status = note.id
                ? NoteStatus.EXPORT_UPDATE
                : NoteStatus.EXPORT_CREATE;

            // Add note
            notes.push(note);
        }

        // Register notes
        for (const note of notes) {
            if (note.id) {
                this.notes[note.id] = note;
            }
        }

        return notes;
    }

    private matchTemplate(rule: ExportRule): MatchResult[] {
        let template = String(rule.template.format);

        const allFields = this.plugin.fields[rule.noteType] ?? [];

        for (const match of rule.template.format.matchAll(ANKI_PATTERN_REGEX)) {
            // Define actions after matching the template and the pattern replacement
            const pattern = match[1];
            let replacement: string;

            // Try to set all fields at once
            if (pattern === 'Fields') {
                replacement = createFieldsRegex(allFields).source;
            }

            // Try to set a single field
            else if (allFields.includes(pattern)) {
                replacement = createFieldRegex(pattern).source;
            }

            // Try to set a special property, such as "Cards" or "Tags"
            else if (TEMPLATE_PATTERNS.includes(pattern)) {
                replacement = TEMPLATE_PATTERN_REGEXES[pattern].source;
            }

            // ERROR: shouldn't happen
            else {
                console.warn(
                    `Pattern '${pattern}' doesn't match any valid pattern, skipping`
                );
                continue;
            }

            template = template.replace(pattern, replacement);
        }

        const regex = new RegExp(`${template}(?:\n?${ID_REGEX.source})?`, 'gm');
        // console.debug('Regex (Template)', regex.source);

        return this.matchAll(regex).map((match) => {
            //
            const fields: Record<string, string> = {};
            for (const field of allFields) {
                const capture = escapeField(field);
                fields[field] = match.groups![capture];
            }

            const { id, deck, cards, tags } = match.groups!;
            return {
                result: match,
                fields,
                deck,
                id,
                cards,
                tags,
            };
        });
    }

    private matchRegex(rule: ExportRule): MatchResult[] {
        const patterns = [
            NOTE_ID_COMMENT_REGEX.source,
            NOTE_DECK_COMMENT_REGEX.source,
            NOTE_TAGS_COMMENT_REGEX.source,
            NOTE_CARDS_COMMENT_REGEX.source,
        ];

        const regex = new RegExp(
            `^${rule.regex.format}(?:${patterns.join('|')})*`,
            'gm'
        );

        const result = this.matchAll(regex).map((match) => {
            const groups = match.slice(1, -patterns.length);

            // Construct fields
            const fields: Record<string, string> = {};
            const allFields = this.plugin.fields[rule.noteType] ?? [];

            for (let idx = 0; idx < allFields.length; idx++) {
                // Read the fields in order or from manually set captures
                let field = allFields[idx];
                if (idx in rule.regex.captures) {
                    field = rule.regex.captures[idx];
                }

                let group = groups.at(idx);

                // Override field if the capture is empty
                if (rule.shouldOverride && group === undefined) {
                    group = '';
                }

                // Set the field to its captured value if anything was captured (or overridden)
                if (group !== undefined) {
                    fields[field] = group;
                }
            }

            const { id, deck, cards, tags } = match.groups!;

            return {
                result: match,
                fields,
                deck,
                id,
                cards,
                tags,
            };
        });

        return result;
    }

    private matchAll(regex: RegExp) {
        return [...this.text.matchAll(regex)].filter((match) => {
            const span = Span.fromMatch(match);

            return !this.searched.overlaps(span);
        });
    }

    private matchPositions(regex: RegExp): [number, string][] {
        return [...this.text.matchAll(regex)].map((match) => {
            return [match.index!, match[1]];
        });
    }

    private findMatch(
        pos: number,
        values: [number, string][]
    ): string | undefined {
        for (const [valuePos, value] of values) {
            if (pos >= valuePos) {
                return value;
            }
        }

        return undefined;
    }
}
