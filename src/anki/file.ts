import { CachedMetadata, TFile } from 'obsidian';
import { Note, NoteStatus } from './note';
import AnkiPlugin from 'plugin';
import {
    ANKI_PATTERN_REGEX,
    createFieldValueRegex,
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
    NOTE_DATE_COMMENT_REGEX,
    NOTE_TEXT_REGEX,
    NOTE_PROPERTIES_REGEX,
} from 'regex';
import * as CryptoJS from 'crypto-js';
import { Span, MultiSpan } from './span';
import { ExportRule } from 'settings/export';
import { moment } from 'obsidian';
import { TEMPLATE_FIELDS as TEMPLATE_PATTERNS } from 'common';
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

const EXPORT_PROPERTY_PATTERNS: [keyof NoteProperties, RegExp][] = [
    ['id', NOTE_ID_COMMENT_REGEX],
    ['datetime', NOTE_DATE_COMMENT_REGEX],
    ['deck', NOTE_DECK_COMMENT_REGEX],
    ['tags', NOTE_TAGS_COMMENT_REGEX],
    ['cards', NOTE_CARDS_COMMENT_REGEX],
];

export interface NoteProperties {
    fields: Record<string, string>;
    id: string;
    datetime: string;
    deck: string;
    cards: string;
    tags: string;
}

export type NoteMatch = {
    match: RegExpMatchArray;
    file: File;
    text: string;
} & Partial<NoteProperties>;

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

    /**
     * Replace some text in the file in a certain region
     * @param oldText - Text to replace
     * @param newText - Replacement
     */
    public replace(oldText: string | RegExp, newText: string) {
        // Verify whether the old text is present in the file
        let shouldReplace: boolean = true;

        if (typeof oldText === 'string') {
            shouldReplace = this.text.indexOf(oldText) != -1;
        } else {
            shouldReplace = (oldText as RegExp).test(this.text);
        }

        // Text is not present; no replacement
        if (!shouldReplace) {
            console.info('No replacy', typeof oldText, this);
            console.info('OLD', oldText);
            console.info('NEW', newText);
            return;
        }

        // Perform replacement
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
        const parts = [
            NOTE_START_COMMENT,
            NOTE_TEXT_REGEX.source,
            NOTE_PROPERTIES_REGEX.source,
            NOTE_END_COMMENT,
        ];

        const regex = new RegExp(parts.join('\n'), 'gmi');

        return this.matchAll(regex).map((match) => {
            const { text, props } = match.groups!;
            const result: NoteMatch = {
                match,
                text,
                file: this,
                ...this.extractProps(props),
            };

            return Note.fromImportMatch(this.plugin, result, rule);
        });
    }

    public findExportNotes(rule: ExportRule): Note[] {
        // Find all notes that match the rule
        const matches =
            rule.type === 'regex'
                ? this.matchRegex(rule)
                : this.matchTemplate(rule);

        return matches.map((match) => {
            // Update part of the file that has been searched
            const span = Span.fromMatch(match.match);
            this.searched.merge(span);

            // Determine where in the file the match occurs
            const pos = match.match.index!;
            const line = this.text.slice(0, pos).split('\n').length;
            const note = Note.fromExportMatch(this.plugin, match, rule);

            // Link to obsidian
            if (rule.link.enabled && rule.link.field) {
                note.setLink(note.file!.tfile.path, rule.link.field, line);
            }

            // Properties that can be set in multiple places
            note.tags = (match.tags ?? this.findMatch(pos, this.tags) ?? '')
                .split(LIST_SEP_REGEX)
                .map((tag) => tag.trim());

            note.deck =
                match.deck ?? this.findMatch(pos, this.decks) ?? rule.deck;

            return note;
        });
    }

    private matchTemplate(rule: ExportRule): NoteMatch[] {
        let template = String(rule.template.format);
        const allFields = this.plugin.fields[rule.noteType] ?? [];

        for (const match of rule.template.format.matchAll(ANKI_PATTERN_REGEX)) {
            // Define actions after matching the template and the pattern replacement
            const [pattern, type] = match.slice(0, 2);
            // console.info('Match', pattern, type, match);
            let replacement: string;

            // Try to set all fields at once
            if (type === 'Fields') {
                replacement = createFieldsRegex(allFields).source;
            }

            // Try to set a single field
            else if (allFields.includes(type)) {
                replacement = createFieldValueRegex(type).source;
            }

            // Try to set a special property, such as "Cards" or "Tags"
            else if (TEMPLATE_PATTERNS.includes(type)) {
                replacement = TEMPLATE_PATTERN_REGEXES[type].source;
            }

            // ERROR: shouldn't happen
            else {
                console.warn(
                    `Pattern '${pattern}' doesn't match any valid pattern, skipping`
                );
                continue;
            }

            template = template
                .replace(pattern, replacement)
                .trim()
                .replace('\n\n', '\n');
        }

        const regex = new RegExp(
            `(?<_note>${template})${NOTE_PROPERTIES_REGEX.source}`,
            'gim'
        );
        console.info('Regex (template)', regex.source);

        return this.matchAll(regex).map((match) => {
            const {
                _note: text,
                _fields,
                props,
                deck,
                tags,
                ...rest
            } = match.groups!;

            // Set fields from {{Fields}} pattern
            const fields: Record<string, string> = this.extractFields(
                _fields,
                allFields
            );

            // Set fields from individual {{...}} patterns
            for (const [field, value] of Object.entries(rest)) {
                if (allFields.includes(field)) {
                    fields[field] = value;
                }
            }

            // Set properties from HTML comments based on the (named) groups
            return {
                ...this.extractProps(props),
                match,
                fields,
                text,
                deck,
                tags,
                file: this,
            };
        });
    }

    private matchRegex(rule: ExportRule): NoteMatch[] {
        // Match against the rule's regex and optionally some properties set in HTML comment
        const regex = new RegExp(
            `(?<text>${rule.regex.format})\\n${NOTE_PROPERTIES_REGEX.source}`,
            'gm'
        );

        const allFields = this.plugin.fields[rule.noteType] ?? [];

        return (
            this.matchAll(regex)
                // Only keep notes that have at least a single capture group set
                .filter((match) => {
                    /*
                         2: ignore full match and <note> group
                        -1: ignore <props> group
                    */
                    const groups = match.slice(2, -1);

                    return groups.some((group) => group !== undefined);
                })
                .map((match) => {
                    const groups = match.slice(2, -1);

                    // Set fields based on the (non-named) capture groups
                    const fields: Record<string, string> = {};

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

                    const { text, props } = match.groups!;
                    return {
                        ...this.extractProps(props),
                        match,
                        fields,
                        text,
                        file: this,
                    };
                })
        );
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

    private extractFields(
        text: string,
        fields: string[]
    ): Record<string, string> {
        const result: Record<string, string> = {};
        const fieldRegex = new RegExp(
            `(?<field>^(?:${fields.map(escapeField).join('|')}))\\s*:\\s*`,
            'gm'
        );

        const matches = [...text.matchAll(fieldRegex)];
        let lastStart: number = 0;

        for (let idx = matches.length - 1; idx >= 0; idx--) {
            const match = matches[idx];
            const { field } = match.groups!;

            // Field value is all text from the start to the start of the next field
            const start = match.index! + match[0].length;
            const end = idx === matches.length - 1 ? undefined : lastStart;
            result[field] = text.slice(start, end).trim();

            lastStart = match.index!;
        }

        return result;
    }

    private extractProps(props: string): NoteProperties {
        let result = {};

        // Set properties from HTML comments based on the (named) capture groups
        for (const [_, regex] of EXPORT_PROPERTY_PATTERNS) {
            const match = props.match(regex);
            if (match && match.groups) {
                result = { ...result, ...match.groups };
            }
        }

        return result as NoteProperties;
    }
}
