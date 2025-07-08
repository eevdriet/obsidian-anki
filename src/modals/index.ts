import { TEMPLATE_FIELDS, WIKI_URL } from 'common';
import { ExtraButtonComponent, Modal, setIcon, Setting } from 'obsidian';
import AnkiPlugin from 'plugin';
import { ANKI_PATTERN_REGEX } from 'regex';

/**
 * Return type for validity checking functions, consisting of
 * - whether the argument is valid
 * - type of validity (error, warning or nothing)
 * - message in case of an error or warning
 */
export type Validity = [boolean, string | undefined, string];

export default abstract class AnkiModal extends Modal {
    plugin: AnkiPlugin;
    onSaveCallback: () => void;

    constructor(plugin: AnkiPlugin, onSaveCallback: () => void) {
        super(plugin.app);

        this.plugin = plugin;
        this.onSaveCallback = onSaveCallback;
    }

    protected abstract display(): void;

    onOpen(): void {
        this.modalEl.style.width = '1000px';
        this.modalEl.style.height = 'auto';
        this.display();
    }

    async onClose() {
        const { contentEl } = this;
        contentEl.empty();

        await this.plugin.save();
        this.onSaveCallback();
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

    // Setup stylines
    button.extraSettingsEl.addClass('obsidi-anki-docs-icon');
}

export function validateTemplate(
    template: string,
    noteFields: string[],
    includeTemplateFields: boolean = false,
    allowNoText: boolean = false
): Validity {
    const fields = [...template.matchAll(ANKI_PATTERN_REGEX)];
    const names = fields.map((field) => field[1]);

    if (fields.length === 0) {
        return [false, 'error', 'Template has no {{...}} replacement patterns'];
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
        return [false, 'error', message];
    }

    // No two patterns only separated by whitespace
    const twoPatternRegex = new RegExp(
        `${ANKI_PATTERN_REGEX.source}[ \\n\\t]*${ANKI_PATTERN_REGEX.source}`,
        'm'
    );
    if ((template.match(twoPatternRegex) ?? []).length > 0) {
        const message =
            'Template cannot have two {{...}} patterns only separated by whitespace';
        return [false, 'error', message];
    }

    // At least some non-whitespace literal text
    const noPatternTemplate = template.replace(ANKI_PATTERN_REGEX, '');
    if (!allowNoText && !/\S/.test(noPatternTemplate)) {
        const message =
            'Template must contain some non-whitespace literal text';
        return [false, 'error', message];
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

        return [false, 'error', message];
    }

    return [true, undefined, ''];
}

export function validateName(
    name: string,
    prevName: string,
    allNames: string[]
): Validity {
    if (name === undefined || name === '') {
        return [false, 'error', 'Name cannot be empty'];
    }

    if (name !== prevName && allNames.includes(name)) {
        return [false, 'error', 'Another rule with this name already exists'];
    }

    return [true, undefined, 'Valid name!'];
}

export function validateNoteType(type: string): Validity {
    if (type === undefined || type === '') {
        return [
            false,
            'error',
            'Note type cannot be empty! Sync with Anki to retrieve available types',
        ];
    }

    return [true, undefined, 'Note type is valid'];
}

export function validate(
    validator: () => Validity,
    messageEl: HTMLElement,
    ...displayEls: HTMLElement[]
): boolean {
    // Perform validation and retrieve validaty type and possible error message
    const [isValid, type, message] = validator();

    // Not (completely) valid: set message and display type of non-validity
    if (type !== undefined) {
        messageEl.setText(message);
        messageEl.addClass(type);

        displayEls.forEach((displayEl) => {
            displayEl.addClass(type);
        });
    }

    // Valid: clear message and display(s)
    else {
        messageEl.setText('');
        messageEl.removeClass('error', 'warning');

        displayEls.forEach((displayEl) => {
            displayEl.removeClass('error', 'warning');
        });
    }

    return isValid;
}
