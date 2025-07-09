import { ExportRule } from './export';
import { ImportRule } from './import';

export type Rule = {
    enabled: boolean;
    noteType: string;
};

export interface AnkiPluginSettings {
    // Sync
    onload: {
        sync: boolean;
        import: boolean;
        export: boolean;
    };

    import: {
        rules: Record<string, ImportRule>;
    };

    export: {
        rules: Record<string, ExportRule>;
        fileDeckComment: string;
        fileTagsComment: string;
    };
}

export const DEFAULT_SETTINGS: AnkiPluginSettings = {
    // Sync
    onload: {
        sync: true,
        import: false,
        export: false,
    },

    import: {
        rules: {},
    },

    export: {
        rules: {},
        fileDeckComment: 'File deck',
        fileTagsComment: 'File tags',
    },
};

export const DEFAULT_TEMPLATE = `Deck: {{Deck}}
Tags: {{Tags}}
{{Fields}}
`;
