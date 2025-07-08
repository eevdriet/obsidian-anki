import { DEFAULT_TEMPLATE } from 'settings';

export type ExportType = 'template' | 'regex';

export type ExportRule = {
    /** What format to use when exporting notes
     * - Template: matches text literally and uses {{Field}} replacements
     * - Regex: matches text through regular expressions and fills fields through capture groups
     */
    type: ExportType;

    enabled: boolean;

    template: {
        format: string;
    };

    regex: {
        format: string;

        // Mapping of which field corresponds to which capture group
        captures: Record<string, string>;
    };

    // Which deck to export the notes into
    deck: string;

    tag: {
        enabled: boolean;

        format: string;
    };

    source: {
        // Path of the folder to search in for export notes
        folder: string;

        // Patterns to include/exclude when searching
        patterns: string[];
    };

    // Which note type to create
    noteType: string;

    // Whether to override fields that are not captured by the regex
    shouldOverride: boolean;

    // Whether to provide a link to the location in Obsidian where the note is from
    link: {
        enabled: boolean;
        field: string;
    };
};

export const DEFAULT_EXPORT_RULE: ExportRule = Object.freeze({
    noteType: '',
    enabled: true,

    type: 'template',
    template: {
        format: DEFAULT_TEMPLATE,
    },

    regex: {
        format: '^([\\w\\s]+) -> ([\\w\\s]+) #flashcard/basic$',
        captures: {},
        cards: [],
    },

    deck: 'Default',

    source: {
        folder: '/',
        patterns: [],
    },

    tag: {
        enabled: false,
        format: 'obsidian',
    },

    shouldOverride: false,

    link: {
        enabled: false,
        field: '',
    },
});
