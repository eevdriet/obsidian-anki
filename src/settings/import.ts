import { DEFAULT_TEMPLATE } from 'settings';

export type ImportType = 'folder' | 'file';
export type ExistingAction = 'ignore' | 'update' | 'append';

export type ImportRule = {
    // Whether the rule currently is enabled
    enabled: boolean;

    // Query to subset all notes for the given note type
    query: string;

    /**
     * Template string to import the notes with
     * Uses roughly the same syntax as Anki does for card creation:
     * - {{Field}} inserts the contents of a field
     * - {{#Field}} and {{/Field}} only create the contents within if the field is set
     */
    template: string;

    tag: {
        enabled: boolean;
        format: string;
    };

    /**
     * How to handle notes that have already been imported before into the current file
     * - ignore: Do not import the note again, i.e. leave the existing version
     * - update: Update the existing version with the latest version from Anki
     * - append: Add the latest version from Anki and leave the existing version
     */
    existingAction: ExistingAction;

    /**
     * Type of import, the notes are imported into a
     * - folder, where each note is put into a separate file
     * - file, where all notes are appended at the end of the file
     */
    type: ImportType;

    folder: {
        path: string;
        fileFormat: string;
    };

    insertAfter: {
        enabled: boolean;

        // Insert the notes after a given string
        format: string;
    };

    file: {
        path: string;
    };
};

export const DEFAULT_IMPORT_RULE: ImportRule = Object.freeze({
    noteType: '',
    enabled: true,
    query: '',
    template: DEFAULT_TEMPLATE,

    tag: {
        enabled: true,
        format: 'anki/flashcard',
    },
    existingAction: 'update',

    type: 'file',

    folder: {
        path: '/',
        fileFormat: '{{Key}}',
    },
    file: {
        path: '',
    },
    insertAfter: {
        enabled: false,

        // Insert the notes after a given string
        format: '# Flashcards',
    },
});
