import { escapeField, escapeRegex } from 'format';
import moment, { Moment } from 'moment';

// Utils
export const LIST_SEP_REGEX = /,\s*?/g;

function createListRegex(regex: RegExp) {
    return new RegExp(
        `(?:${regex.source}${LIST_SEP_REGEX.source})*${regex.source}`
    );
}

export function countCaptureGroups(regex: RegExp): number {
    const groups = [...regex.source.matchAll(/(?<!\\)(\()(?!\?:)/g)];

    return groups.length;
}

function createPatternsRegex(patterns: string[]): RegExp {
    return new RegExp(`(?:${patterns.join('|')})`, 'gm');
}

// Obsidian
export const OBSIDIAN_MATH_INLINE_REGEX =
    /(?<!\$)\$((?=[\S])(?=[^$])[\s\S]*?\S)\$/g;
export const OBSIDIAN_MATH_BLOCK_REGEX = /\$\$([\s\S]*?)\$\$/g;
export const OBSIDIAN_CODE_INLINE_REGEX = /(?<!`)`(?=[^`])[\s\S]*?`/g;
export const OBSIDIAN_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;

// Anki
export const ANKI_MATH_INLINE_REGEX = /(\\\[[\s\S]*?\\\])|(\\\([\s\S]*?\\\))/g;
export const ANKI_MATH_BLOCK_REGEX = /(\\\[[\s\S]*?\\\])|(\\\([\s\S]*?\\\))/g;
export const ANKI_CODE_INLINE_REGEX = /(?<!`)`(?=[^`])[\s\S]*?`/g;
export const ANKI_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;

export const ANKI_PATTERN_REGEX = /\{\{([^:"{}]*)\}\}/g;
export const ANKI_CLOZE_REGEX =
    /\{\{c(?<cloze_number>\d+)::(?<cloze_value>.+?)\}\}/gm;

// Note
// - Patterns
export const createComment = (text: string): string => {
    return `<!-- ${text} -->`;
};
export const createCommentRegex = (
    text: string,
    withLineDelims: boolean = true
): RegExp => {
    let regex = `\\s*<!--\\s*${text}\\s*\\s*-->\\s*`;
    if (withLineDelims) {
        regex = `^${regex}$`;
    }

    return new RegExp(regex, 'im');
};

export const createPattern = (text: string): RegExp => {
    return new RegExp(`\{\{${text}\}\}`, 'im');
};

export const NOTE_START_COMMENT = createComment('Note start');
export const NOTE_END_COMMENT = createComment('Note end');

export const DECK_PATTERN = createPattern('Deck');
export const CARDS_PATTERN = createPattern('Cards');
export const TAGS_PATTERN = createPattern('Tags');
export const FIELDS_PATTERN = createPattern('Fields');

// - Base
export const ID_REGEX = /(?<id>\d+)/g;
export const DATE_TIME_REGEX =
    /(?<datetime>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g;
export const DECK_REGEX = /(?<deck>[a-zA-Z0-9 ]+(?:::[a-zA-Z0-9 ]+)*)/;

export const TAG_REGEX = /[a-zA-Z0-9\/_-]+/;
export const TAGS_REGEX = new RegExp(
    `(?<tags>${createListRegex(TAG_REGEX).source})`
);

export const CARD_REGEX = /[a-zA-Z0-9\/_-]+/;
export const CARDS_REGEX = new RegExp(
    `(?<cards>${createListRegex(CARD_REGEX).source})`
);

// - File
export const createFileDeckCommentRegex = (header: string) =>
    new RegExp(
        `^\\s*<!--\\s*${header}:\\s*${DECK_REGEX.source}\\s*-->\\s*$`,
        'gm'
    );

export const createFileTagsCommentRegex = (header: string) =>
    new RegExp(
        `^\\s*<!--\\s*${header}:\\s*${TAGS_REGEX.source}\\s*-->\\s*$`,
        'gm'
    );

// - Note
export const NOTE_ID_COMMENT_REGEX = createCommentRegex(
    `Note id(?:entifier)?:\\s*${ID_REGEX.source}`,
    false
);
export const NOTE_TEXT_REGEX = /(?<text>(?:.|\n)+?)/gm;

export const NOTE_DATE_COMMENT_REGEX = createCommentRegex(
    `Note (?<type>import|export) date time:\\s*${DATE_TIME_REGEX.source}`,
    false
);

export function createTimeStampComment(type: 'import' | 'export', dt?: Moment) {
    const now = (dt ?? moment()).format('YYYY-MM-DD HH:mm:ss');

    return createComment(`Note ${type} date time: ${now}`);
}

export const NOTE_DECK_COMMENT_REGEX = new RegExp(
    `\\n<!--\\s*Note deck:\\s*${DECK_REGEX.source}\\s*-->`,
    'gmi'
);
export const NOTE_CARDS_COMMENT_REGEX = new RegExp(
    `\\n<!--\\s*Note cards:\\s*${CARDS_REGEX.source}\\s*-->`,
    'gmi'
);
export const NOTE_TAGS_COMMENT_REGEX = new RegExp(
    `\\n<!--\\s*Note tags:\\s*${TAGS_REGEX.source}\\s*-->`,
    'gmi'
);

// - Fields
// export const FIELD_REGEX = /[a-zA-Z0-9 _-]+/;
export const FIELD_REGEX = /.+/;
export const FIELD_VALUE_REGEX = /.+/;

export function createFieldRegex(field: string): RegExp {
    const result = new RegExp(
        `${FIELD_REGEX.source}\\s*:\\s*(?<${field}>${FIELD_VALUE_REGEX.source})`
    );

    return result;
}

export function createFieldRegex2(field: string, group?: string): RegExp {
    const regex = group
        ? `\\{\\{(?<${group}>${field})\\}\\}`
        : `\\{\\{${field}\\}\\}`;

    return new RegExp(regex, 'gm');
}

export function createFieldsRegex(fields: string[]): RegExp {
    const patterns = fields.map((field, idx) => {
        field = escapeRegex(field);
        const name = `field${idx}`;

        return createFieldRegex2(field, name).source;
    });

    return createPatternsRegex(patterns);
}

export const TEMPLATE_PATTERN_REGEXES: Record<string, RegExp> = {
    Tags: TAGS_REGEX,
    Deck: DECK_REGEX,
};

// Utils
export function getRegex101URL(regex: string) {
    const regexURI = encodeURIComponent(regex);

    // return `regex101.com/?regex=${regexURI}&flags=gm&flavor=ecmascript`;
    return `https://regex101.com/?regex=${regexURI}&flags=gm&flavor=javascript`;
}
