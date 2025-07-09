import Formatter from 'format';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { App } from 'obsidian';
import { ANKI_AUDIO_REGEX, ANKI_IMAGE_REGEX, ANKI_VIDEO_REGEX } from 'regex';

export default class ImportFormatter extends Formatter {
    converter: NodeHtmlMarkdown;

    // Maps from Anki path to Obsidian embed path
    media: Map<string, string> = new Map();

    constructor(app: App) {
        super(app);

        this.converter = new NodeHtmlMarkdown({});
    }

    override async formatStr(html: string): Promise<string> {
        this.result = String(html);
        await this.formatMedia();

        // this.result = this.converter.translate(this.result);
        return Promise.resolve(this.result);
    }

    async formatMedia(): Promise<void> {
        if (!this.note || !this.note.file) {
            return;
        }

        const sourcePath = this.note?.file?.tfile.path;

        /**
         * Format Anki media and determine the embed path in the Obsidian vault
         * @param regex - Regular expression for the media type to format
         */
        const format = async (regex: RegExp): Promise<void> => {
            const replacer = async (match: RegExpMatchArray) => {
                const [_, mediaPath] = match;

                // Find the embed path within the Obsidian vault the media can be attached
                // NOTE: replacement to avoid reimports (e.g. "Img.png", "Img 1.png", ...)
                let attachPath =
                    this.media.get(mediaPath) ??
                    (await this.app.fileManager.getAvailablePathForAttachment(
                        mediaPath,
                        sourcePath
                    ));

                attachPath = attachPath.replace(/(.*?)( \d+)(\.\w+)/, '$1$3');
                this.media.set(mediaPath, attachPath);

                return `![[${attachPath}]]`;
            };

            // Find replacement (Obsidian embed paths)
            const replacements = await Promise.all(
                Array.from(this.result.matchAll(regex), (match) =>
                    replacer(match)
                )
            );

            // Perform actual replacement
            let i = 0;
            this.result = this.result.replace(regex, () => replacements[i++]);
        };

        // Format media separately for each type
        await format(ANKI_AUDIO_REGEX);
        await format(ANKI_IMAGE_REGEX);
        await format(ANKI_VIDEO_REGEX);
    }
}
