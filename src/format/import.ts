import Formatter from 'format';
import { NodeHtmlMarkdown } from 'node-html-markdown';

export default class ImportFormatter extends Formatter {
    converter: NodeHtmlMarkdown;

    constructor(vault: string) {
        super(vault);

        this.converter = new NodeHtmlMarkdown({});
    }

    override formatStr(html: string): string {
        this.result = String(html);

        return this.converter.translate(this.result);
    }
}
