import Formatter, { escapeRegex, formatURI } from 'format';

import { Converter } from 'showdown';
import showdownHighlight from 'showdown-highlight';

import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from 'common';
import { extname } from 'path';
import { basename } from 'path/win32';
import {
    ANKI_CODE_BLOCK_REGEX,
    ANKI_CODE_INLINE_REGEX,
    ANKI_MATH_INLINE_REGEX,
    ANKI_MATH_BLOCK_REGEX,
    OBSIDIAN_MATH_INLINE_REGEX,
    OBSIDIAN_MATH_BLOCK_REGEX,
} from 'regex';

const MATH_INLINE_REPLACE = 'MATH-INLINE-REPLACE';
const MATH_BLOCK_REPLACE = 'MATH-BLOCK-REPLACE';
const CODE_INLINE_REPLACE = 'CODE-INLINE-REPLACE';
const CODE_BLOCK_REPLACE = 'CODE-BLOCK-REPLACE';

const PARAGRAPH_OPEN = '<p>';
const PARAGRAPH_CLOSE = '</p>';

export default class ExportFormatter extends Formatter {
    converter: Converter;

    constructor(vault: string) {
        super(vault);

        this.converter = new Converter({
            simplifiedAutoLink: true,
            literalMidWordUnderscores: true,
            tables: true,
            tasklists: true,
            simpleLineBreaks: true,
            requireSpaceBeforeHeadingText: true,
            extensions: [showdownHighlight],
        });
    }

    override formatStr(markdown: string): string {
        this.result = String(markdown);

        // Censor formats that are suspectible to change
        const mathInlines = this.censor(
            ANKI_MATH_INLINE_REGEX,
            MATH_INLINE_REPLACE
        );
        const mathBlocks = this.censor(
            ANKI_MATH_BLOCK_REGEX,
            MATH_BLOCK_REPLACE
        );
        const codeInlines = this.censor(
            ANKI_CODE_INLINE_REGEX,
            CODE_INLINE_REPLACE
        );
        const codeBlocks = this.censor(
            ANKI_CODE_BLOCK_REGEX,
            CODE_BLOCK_REPLACE
        );

        // Replace Markdown elements such as links and media
        this.formatLinks();
        this.formatCloze();
        this.formatMedia();

        // Decensor formats back to their original state
        this.decensor(CODE_BLOCK_REPLACE, codeBlocks, false);
        this.decensor(CODE_INLINE_REPLACE, codeInlines, false);
        this.decensor(MATH_BLOCK_REPLACE, mathBlocks, true);
        this.decensor(MATH_INLINE_REPLACE, mathInlines, true);

        // Convert to HTML
        let result = this.converter.makeHtml(this.result);

        // Remove unnecessary paragraph tag
        if (
            result.startsWith(PARAGRAPH_OPEN) &&
            result.endsWith(PARAGRAPH_CLOSE)
        ) {
            result = result.slice(
                PARAGRAPH_OPEN.length,
                -PARAGRAPH_CLOSE.length
            );
        }

        if (false && markdown != result) {
            console.info(`Result (pre -> post)
${markdown}
<--->
${result}
`);
        }

        return result;
    }

    formatMedia(): void {
        const embeds = this.note?.file?.cache?.embeds;
        if (!embeds) {
            return;
        }

        for (const embed of embeds) {
            if (!this.result.includes(embed.original)) {
                continue;
            }

            const ext = extname(embed.link);
            const name = basename(embed.link);

            const before = new RegExp(escapeRegex(embed.original), 'g');
            let after = undefined;

            // Audio
            if (AUDIO_EXTENSIONS.includes(ext)) {
                after = `[sound:${name}]`;
            }

            // Images
            else if (IMAGE_EXTENSIONS.includes(ext)) {
                after = `<img src="${name}" alt="${embed.displayText}">`;
            }

            // Unknown
            else {
                console.warn(
                    `Unsupported extension: ${ext} (found from ${name})`
                );
            }

            // Replace
            if (after) {
                this.result = this.result.replace(before, after);
            }
        }
    }

    formatLinks(): void {
        const links = this.note?.file?.cache?.links;
        if (!links) {
            return;
        }

        for (const link of links) {
            const before = new RegExp(escapeRegex(link.original), 'g');
            const after = `<a href="${formatURI(this.vault, link.link)}">${link.displayText}</a>`;

            this.result = this.result.replace(before, after);
        }
    }

    formatCloze(): void {}

    formatMath(): void {
        this.result = this.result
            .replace(OBSIDIAN_MATH_BLOCK_REGEX, '\\[$1\\]')
            .replace(OBSIDIAN_MATH_INLINE_REGEX, '\\($1\\)');
    }
}
