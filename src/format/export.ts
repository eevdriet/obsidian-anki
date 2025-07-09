import Formatter, {
    CODE_BLOCK_REPLACE,
    CODE_INLINE_REPLACE,
    escapeRegex,
    formatURI,
    MATH_BLOCK_REPLACE,
    MATH_INLINE_REPLACE,
    PARAGRAPH_CLOSE,
    PARAGRAPH_OPEN,
} from 'format';

import { readFileSync } from 'fs';

import { Converter } from 'showdown';
import showdownHighlight from 'showdown-highlight';

import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from 'common';
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
import { AnkiMedia } from 'anki/connect';

export default class ExportFormatter extends Formatter {
    converter: Converter;

    mediaLinks: Set<string> = new Set();
    media: AnkiMedia[] = [];

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

        // Replace Markdown elements such as links and media
        this.formatLinks();
        this.formatCloze();
        this.formatMedia();

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

        // Decensor formats back to their original state
        this.decensor(CODE_BLOCK_REPLACE, codeBlocks, false);
        this.decensor(CODE_INLINE_REPLACE, codeInlines, false);
        this.decensor(MATH_BLOCK_REPLACE, mathBlocks, true);
        this.decensor(MATH_INLINE_REPLACE, mathInlines, true);

        return this.convertToHTML();
    }

    formatMedia(): void {
        if (!this.note) {
            return;
        }

        const embeds = this.note.file?.cache?.embeds ?? [];
        console.info('Embeds', embeds);

        for (const embed of embeds) {
            if (!this.result.includes(embed.original)) {
                continue;
            }

            const { link, original, displayText } = embed;

            const ext = extname(link);
            const name = basename(link);

            const before = new RegExp(escapeRegex(original), 'g');
            let after = undefined;

            // Audio
            if (AUDIO_EXTENSIONS.includes(ext)) {
                after = `[sound:${name}]`;
                console.info('Sound', after);
            }

            // Images
            else if (IMAGE_EXTENSIONS.includes(ext)) {
                after = `<img src="${name}" alt="${displayText}">`;
                console.info('Image', after);
            }

            // Videos
            else if (VIDEO_EXTENSIONS.includes(ext)) {
                const videoType = `type="video/${ext.slice(1)}"`;
                after = `<video controls><source src="${name}" ${videoType}></video>`;
                console.info('Video', after);
            }

            // Unknown
            else {
                console.warn(
                    `Unsupported extension: ${ext} (found from ${name})`
                );
            }

            if (!after) {
                continue;
            }

            // Replace the media format in the text
            this.result = this.result.replace(before, after);

            // Store the media file/URL so it can be uploaded to Anki
            if (this.mediaLinks.has(link)) {
                continue;
            }
            this.mediaLinks.add(link);

            // Retrieve the absolute path to the media file
            const path = this.note.getMediaPath(link);
            if (!path) {
                continue;
            }

            // Read the base64 data of the media file to store it in Anki
            const file = readFileSync(path);
            const data = file.toString('base64');

            this.media.push({
                filename: link,
                path,
                data,
            });
        }
    }

    formatLinks(): void {
        const links = this.note?.file?.cache?.links;
        if (!links) {
            return;
        }

        console.info('Links', links);

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

    convertToHTML(): string {
        // Convert to HTML
        let result = this.converter.makeHtml(this.result);

        // Remove unnecessary paragraph parent tag
        if (
            result.startsWith(PARAGRAPH_OPEN) &&
            result.endsWith(PARAGRAPH_CLOSE)
        ) {
            result = result.slice(
                PARAGRAPH_OPEN.length,
                -PARAGRAPH_CLOSE.length
            );
        }

        return result;
    }
}
