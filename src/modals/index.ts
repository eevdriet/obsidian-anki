import { TEMPLATE_FIELDS, WIKI_URL } from 'common';
import { ExtraButtonComponent, Modal, setIcon, Setting } from 'obsidian';
import AnkiPlugin from 'plugin';
import { ANKI_PATTERN_REGEX } from 'regex';

export default abstract class AnkiModal extends Modal {
    plugin: AnkiPlugin;
    onSaveCallback: () => void;

    constructor(plugin: AnkiPlugin, onSaveCallback: () => void) {
        super(plugin.app);

        this.plugin = plugin;
        this.onSaveCallback = onSaveCallback;
    }

    protected abstract display(): void;

    async onSave(): Promise<void> {
        await this.plugin.save();
        this.onSaveCallback();
    }

    onOpen(): void {
        this.modalEl.style.width = '1000px';
        this.modalEl.style.height = 'auto';
        this.display();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export function addSection(
    containerEl: HTMLElement,
    name: string | DocumentFragment,
    desc: string | DocumentFragment,
    icon: string,
    nested: boolean = false
) {
    const heading = new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .setHeading();

    const parentEl = heading.settingEl;
    if (nested) {
        parentEl.addClass('setting-item-nested-heading');
    }

    // Set icon
    const iconEl = parentEl.createDiv();
    setIcon(iconEl, icon);
    iconEl.addClass('obsidi-anki-settings-icon');
    parentEl.prepend(iconEl);

    return heading;
}

export function setupWikiButton(button: ExtraButtonComponent, section: string) {
    button
        .setIcon('info')
        .setTooltip('Open documentation')
        .onClick(() => {
            const a = new DocumentFragment().createEl('a', {
                text: `${section} documentation`,
                href: `${WIKI_URL}/${section}`,
                attr: { target: '_blank', rel: 'noopener' },
            });
            // Dummy click to download
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
}

export function validateTemplate(
    template: string,
    noteFields: string[],
    includeTemplateFields: boolean = false
): [boolean, string] {
    const fields = [...template.matchAll(ANKI_PATTERN_REGEX)];
    const names = fields.map((field) => field[1]);

    if (fields.length === 0) {
        return [false, 'Template has no {{...}} replacement patterns'];
    }

    // At least 1 {{Field}} name required
    const possibleFields = [...noteFields];
    if (includeTemplateFields) {
        possibleFields.push('Fields');
    }
    const fieldsStr = noteFields.map((f) => `- ${f}`).join('\n');

    if (
        names.length === 0 ||
        !names.some((name) => possibleFields.includes(name))
    ) {
        let message = `Template should have at least one {{Field}} replacement:\n${fieldsStr}`;
        if (includeTemplateFields) {
            message = `Template should have {{Fields}} or at least one {{Field}} replacement:\n${fieldsStr}`;
        }
        return [false, message];
    }

    // No two patterns only separated by whitespace on the same line
    const twoPatternRegex = new RegExp(
        `${ANKI_PATTERN_REGEX.source}[ \\t]*${ANKI_PATTERN_REGEX.source}`,
        'm'
    );
    if ((template.match(twoPatternRegex) ?? []).length > 0) {
        const message =
            'Template cannot have two {{...}} patterns only separated by whitespace';
        return [false, message];
    }

    // At least some non-whitespace literal text
    const noPatternTemplate = template.replace(ANKI_PATTERN_REGEX, '');
    if (!/\S/.test(noPatternTemplate)) {
        const message =
            'Template must contain some non-whitespace literal text';
        return [false, message];
    }

    // Invalid {{Field}} name
    const validPatterns = [...noteFields];
    if (includeTemplateFields) {
        validPatterns.push(...TEMPLATE_FIELDS);
    }

    if (names.some((name) => !validPatterns.includes(name))) {
        // Message
        let message = `Template should only have {{...}} patterns for a field:\n${fieldsStr}`;
        if (!includeTemplateFields) {
            message = `Template should only have {{...}} patterns for
    ${TEMPLATE_FIELDS.map((f) => `- ${f}`).join('\n')}
    or replace a field directly:\n${fieldsStr}`;
        }

        return [false, message];
    }

    return [true, ''];
}
