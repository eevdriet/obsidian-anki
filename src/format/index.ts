import { Note } from 'anki/note';
import { TEMPLATE_FIELDS } from 'common';
import { ANKI_CLOZE_REGEX, ANKI_PATTERN_REGEX } from 'regex';

export interface FileEscapeOptions {
    // Replaces {{cn::<cloze>}} with just <cloze>
    removeClozes?: boolean;

    // Removes LaTeX environment markers, such as \(\), \[\], $$, $$$$
    removeLatex?: boolean;
}

export const DEFAULT_FILE_NAME_ESCAPE_OPTIONS: FileEscapeOptions = {
    removeClozes: true,
    removeLatex: true,
};

export default abstract class Formatter {
    vault: string;

    note?: Note;
    result: string = '';

    constructor(vault: string) {
        this.vault = vault;
    }

    public abstract formatStr(txt: string): string;

    public format(note: Note): Note {
        const result: Note = note.clone();

        this.note = result;

        for (const [field, value] of Object.entries(result.fields)) {
            result.fields[field] = this.formatStr(value.trim());
        }

        return result;
    }

    protected censor(before: RegExp, after: string): string[] {
        const matches: string[] = [];
        for (const match of this.result.matchAll(before)) {
            matches.push(match[0]);
        }

        this.result = this.result.replace(before, after);
        return matches;
    }

    protected decensor(
        before: string,
        matches: string[],
        shouldEscape: boolean
    ) {
        for (const match of matches) {
            const after = shouldEscape ? escapeHTML(match) : match;
            this.result = this.result.replace(before, after);
        }
    }
}

/**
 * Escape file name for safe use as Obsidian name
 * @param name - Name to esacpe
 * @returns Safe to use Obsidian file name
 */
export function escapeFileName(
    name: string,
    opts: FileEscapeOptions = DEFAULT_FILE_NAME_ESCAPE_OPTIONS
): string {
    let result = String(name);

    if (opts.removeClozes) {
        result = result.replace(
            ANKI_CLOZE_REGEX,
            (_match, _number, value) => value
        );
    }

    return result.replace(/[\[#\^|\\\/\]?:]/g, '');
}

export function escapeRegex(regex: string): string {
    // Got from stackoverflow - https://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript
    return regex.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Escape HTML string for safe use
 * @param html - String to escape
 * @returns Safe to use HTML string
 */
export function escapeHTML(html: string): string {
    return html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function escapeField(field: string): string {
    return escapeRegex(field.toLowerCase().replace(/\s+/, '_'));
}

export function formatTemplate(template: string, note: Note): string {
    return template.replace(ANKI_PATTERN_REGEX, (field, key) => {
        // Do not replace any non-fields or special patterns
        if (!(TEMPLATE_FIELDS.includes(key) || key in note.fields)) {
            return field;
        }

        // Replace fields keys with their values
        if (key in note.fields) {
            return note.fields[key];
        }

        // Handle special patterns
        if (key === 'Deck' && note.deck) {
            return note.deck;
        }

        // TODO: figure out how to get the card type names instead of their IDs
        if (key === 'Cards' && note.cards) {
            return note.cards.map((card) => card.toString()).join(', ');
        }

        if (key === 'Tags' && note.tags) {
            return note.tags.join(', ');
        }

        if (key === 'Fields') {
            return Object.entries(note.fields)
                .map(([field, name]) => `${field}: ${name}`)
                .join('\n');
        }

        // Return unaltered by default
        return field;
    });
}

export function formatURI(vault: string, file: string) {
    const vaultURI = encodeURIComponent(vault);
    const fileURI = encodeURIComponent(file);

    return `obsidian://open?vault=${vaultURI}&file=${fileURI}`;
}
