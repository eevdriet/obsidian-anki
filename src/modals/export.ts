import { PRIMARY_BUTTON_CLASS } from 'common';
import AnkiModal, { setupWikiButton, validateTemplate } from 'modals';
import {
    ButtonComponent,
    DropdownComponent,
    ExtraButtonComponent,
    setIcon,
    Setting,
    TextAreaComponent,
    TextComponent,
} from 'obsidian';
import AnkiPlugin from 'plugin';
import { DEFAULT_EXPORT_RULE, ExportType, ExportRule } from 'settings/export';
import { addSection } from 'modals';
import { FolderSuggest, TextSuggest } from './suggest';
import { countCaptureGroups } from 'regex';

export default class ExportModal extends AnkiModal {
    initialName: string;
    currName: string;

    rule: ExportRule;
    rules: Record<string, ExportRule>;

    isValidName: boolean = false;
    isValidNoteType: boolean = false;
    isValidFormat: boolean = false;

    exportDiv?: HTMLDivElement;
    saveButton?: ButtonComponent;

    fieldsDiv?: HTMLDivElement;
    isFormatSwitch: boolean = false;
    capturesOpened: boolean = false;
    capturesButton?: ExtraButtonComponent;
    capturesDiv?: HTMLDivElement;

    constructor(name: string, plugin: AnkiPlugin, onSaveCallback: () => void) {
        super(plugin, onSaveCallback);

        this.plugin = plugin;
        this.onSaveCallback = onSaveCallback;
        this.initialName = name;
        this.currName = name;

        this.rules = this.plugin.settings.export.rules;
        this.rule = this.rules[this.currName] ?? { ...DEFAULT_EXPORT_RULE };
    }

    override async onSave(): Promise<void> {
        delete this.rules[this.initialName];
        this.rules[this.currName] = this.rule;

        super.onSave();
    }

    override display() {
        const { contentEl } = this;
        contentEl.empty();

        this.displayHeader(contentEl);
        this.displayName(contentEl);
        this.displayNoteType(contentEl);
        this.displayDecks(contentEl);

        this.addExportFormat(contentEl);
        this.displayFields(contentEl);
        this.displayFiles(contentEl);
    }

    private displayHeader(contentEl: HTMLElement) {
        const action = this.initialName === '' ? 'Create' : 'Edit';
        contentEl.createEl('h1', { text: `${action} exporter` });

        const section = addSection(contentEl, 'General', '', 'cog');
        section
            .addButton((button) => {
                this.saveButton = button;
                button
                    .setButtonText('Save')
                    .setClass(PRIMARY_BUTTON_CLASS)
                    .onClick(async () => {
                        await this.onSave();
                        this.close();
                    });

                this.validateSaveButton();
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Exporting#general')
            );
    }

    private displayName(contentEl: HTMLElement) {
        let name: TextComponent;

        const validate = () => {
            const checkValidity = (): [boolean, string | undefined, string] => {
                const value = name.getValue();

                if (value === undefined || value === '') {
                    return [false, 'error', 'Name cannot be empty!'];
                }

                if (
                    value !== this.initialName &&
                    Object(this.rules).hasOwnProperty(value)
                ) {
                    return [
                        true,
                        'warning',
                        'Another rule with this name already exists! Only save if you want to override it',
                    ];
                }

                return [true, undefined, 'Valid name!'];
            };

            // Check whether the name is valid and setting possible error/warning messages
            const [isValid, type, message] = checkValidity();

            if (type !== undefined) {
                name.inputEl.addClass(type);
                nameWarningEl.addClass(type);
                nameWarningEl.setText(message);
            } else {
                name.inputEl.removeClass('error', 'warning');
                nameWarningEl.removeClass('error', 'warning');
                nameWarningEl.setText('');
            }

            this.isValidName = isValid;
            this.validateSaveButton();

            return isValid;
        };

        new Setting(contentEl)
            .setName('Name')
            .setDesc('Name of the rule to apply')
            .addText((text) => {
                name = text;

                const type = this.rule.noteType;
                const placeholder =
                    type === '' || type === undefined ? 'New rule' : type;

                text.setPlaceholder(placeholder)
                    .setValue(this.currName)
                    .onChange((value) => {
                        const isValid = validate();
                        if (isValid) {
                            this.currName = value;
                        }
                    });
            });

        const nameWarningEl = contentEl.createEl('div');

        validate();
    }

    private displayNoteType(contentEl: HTMLElement) {
        // Select note type
        let noteType: DropdownComponent;

        const validate = () => {
            const value = noteType.getValue();

            const isValid = value !== undefined && value !== '';
            if (isValid) {
                noteType.selectEl.removeClass('error');
                noteWarningEl.setText('');
            } else {
                noteType.selectEl.addClass('error');
                noteWarningEl.setText(
                    'Note type cannot be empty! Sync with Anki to retrieve available types'
                );
            }

            this.isValidNoteType = isValid;
            this.validateSaveButton();

            return isValid;
        };

        new Setting(contentEl)
            .setName('Note type')
            .setDesc('Select the note type to export')
            .addDropdown((dropdown) => {
                noteType = dropdown;

                // Find all types that have no exporter defined for them yet
                const types = this.plugin.noteTypes ?? [];
                types.forEach((type) => dropdown.addOption(type, type));

                // Set the current type or the first available one if none is set
                let type = this.rule.noteType;
                if (type === '' && types.length > 0) {
                    type = types[0];
                    this.rule.noteType = type;
                }

                dropdown.setValue(type);
                dropdown.onChange((value) => {
                    if (validate()) {
                        this.rule.noteType = value;

                        // Redisplay dependent parts of the modal
                        this.displayFields(contentEl);

                        this.rule.regex.captures = {};
                        this.addCaptureGroups(contentEl);
                    }
                });
            });

        const noteWarningEl = contentEl.createEl('div', {
            cls: 'error',
            text: '',
        });

        validate();
    }

    private displayDecks(contentEl: HTMLElement) {
        const decks = this.plugin.decks ?? [];

        new Setting(contentEl)
            .setName('Deck')
            .setDesc(
                'Deck to export notes to when no deck is specified for the exporter rule'
            )
            .addText((text) => {
                new TextSuggest(this.app, text.inputEl, decks);
                text.setPlaceholder(DEFAULT_EXPORT_RULE.deck)
                    .setValue(this.rule.deck)
                    .onChange((value) => {
                        this.rule.deck = value;
                        this.plugin.save();
                    });
            });
    }

    private addExportFormat(contentEl: HTMLElement) {
        console.info('All this (export)', this);
        if (this.exportDiv === undefined) {
            this.exportDiv = contentEl.createDiv();
            this.exportDiv.style.display = 'block';
            this.exportDiv.style.margin = '11.25px 0';
        }

        const parentEl = this.exportDiv;
        parentEl.empty();

        // Header
        const formatSection = addSection(
            parentEl,
            'Format',
            'Set the format of the note as a template or regular expression',
            'pencil'
        );

        formatSection
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        template: 'Template',
                        regex: 'Regular expression',
                    })
                    .setValue(this.rule.type)
                    .onChange((format: ExportType) => {
                        this.isFormatSwitch = format === this.rule.type;
                        this.rule.type = format;
                        this.addExportFormat(contentEl);
                    });
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Exporting#format')
            );

        switch (this.rule.type) {
            case 'template':
                this.addTemplateExport(parentEl);
                break;
            case 'regex':
                this.capturesDiv = undefined;
                this.capturesButton = undefined;

                this.addRegexExport(parentEl);
                break;
        }
    }

    private addTemplateExport(contentEl: HTMLElement) {
        let templateInput: TextAreaComponent;

        const validate = () => {
            const value = templateInput?.getValue() ?? '';
            const noteFields = this.plugin.fields
                ? this.plugin.fields[this.rule.noteType]
                : [];

            const [isValid, message] = validateTemplate(
                value,
                noteFields,
                true
            );
            if (!isValid) {
                templateInput.inputEl.addClass('error');
                templateWarningEl.setText(message);
            } else {
                templateInput.inputEl.removeClass('error');
                templateWarningEl.setText('');
            }

            this.isValidFormat = isValid;
            this.validateSaveButton();

            return isValid;
        };

        const templateTextEl = new Setting(contentEl)
            .setName('Template')
            .addTextArea((text) => {
                templateInput = text;
                text.inputEl.rows = 10;
                text.inputEl.cols = 220;
                text.inputEl.style.width = '100%';
                text.inputEl.style.boxSizing = 'border-box';

                text.setPlaceholder('Template')
                    .setValue(this.rule.template.format)
                    .onChange((value) => {
                        this.rule.template.format = value;
                        validate();
                    });
            });

        templateTextEl.settingEl.style.flexDirection = 'column';
        templateTextEl.settingEl.style.alignItems = 'flex-start';

        const templateWarningEl = contentEl.createDiv({
            cls: 'error',
        });
        templateWarningEl.style.whiteSpace = 'pre-wrap';

        validate();
    }

    private addRegexExport(contentEl: HTMLElement) {
        let regexInput: TextAreaComponent;

        const validate = () => {
            let isValid = true;
            let message = 'Valid regular expression!';
            const value = regexInput.getValue();

            try {
                const regex = new RegExp(value);
                const nGroups = countCaptureGroups(regex);

                if (nGroups === 0) {
                    isValid = false;
                    message = 'No capture groups to capture fields';
                }
            } catch (err) {
                isValid = false;
                message = `${err}`;
            }

            if (!isValid) {
                regexInput.inputEl.addClass('error');
                regexWarningEl.setText(message);
            } else {
                regexInput.inputEl.removeClass('error');
                regexWarningEl.setText('');
            }

            this.isValidFormat = isValid;
            this.validateSaveButton();

            return isValid;
        };

        // Regular expressions
        const regexTextEl = new Setting(contentEl)
            .setName('Regular expression')
            .addTextArea((text) => {
                regexInput = text;

                text.inputEl.rows = 5;
                text.inputEl.cols = 220;
                text.inputEl.style.width = '100%';
                text.inputEl.style.boxSizing = 'border-box';

                text.setPlaceholder('Regular expression');
                text.onChange((value) => {
                    const isValid = validate();

                    if (isValid) {
                        this.rule.regex.format = value;
                        this.displayFields(contentEl);
                        this.addCaptureGroups(contentEl);
                    }
                });
                text.setValue(this.rule.regex.format);
            });

        regexTextEl.settingEl.style.flexDirection = 'column';
        regexTextEl.settingEl.style.alignItems = 'flex-start';

        const regexWarningEl = contentEl.createDiv({
            cls: 'error',
        });

        const capturesSection = new Setting(contentEl)
            .setName('Captures')
            .setDesc(
                'Map the fields of the note type to a specific capture group'
            );

        capturesSection
            .addExtraButton((button) => {
                this.capturesButton = button;

                button
                    .setIcon('chevron-right')
                    .setTooltip('Add new field capture')
                    .onClick(() => {
                        // Captures open state should not change on redraw regex setting
                        if (!this.isFormatSwitch) {
                            this.capturesOpened = !this.capturesOpened;
                        }

                        this.addCaptureGroups(contentEl);
                    });
            })
            .addExtraButton((button) => {
                button
                    .setIcon('list-restart')
                    .setTooltip('Reset field order')
                    .onClick(() => {
                        Object.keys(this.rule.regex.captures).forEach(
                            (field, idx) => {
                                this.rule.regex.captures[field] = `${idx + 1}`;
                            }
                        );

                        this.addCaptureGroups(contentEl);
                    });
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Regular-expressions#field-order')
            );

        this.addCaptureGroups(contentEl);
        validate();
    }

    private addCaptureGroups(contentEl: HTMLElement) {
        const settings: Record<string, Setting> = {};
        const nGroups = countCaptureGroups(new RegExp(this.rule.regex.format));

        // Display whether the capture groups menu is opened
        this.capturesButton?.setIcon(
            this.capturesOpened ? 'chevron-down' : 'chevron-right'
        );

        // Create the element to draw the capture groups in
        if (this.capturesDiv === undefined) {
            this.capturesDiv = contentEl.createDiv();
        }

        const parent = this.capturesDiv;
        parent.empty();

        // Toggle whether to show the capture groups with the button
        if (!this.capturesOpened && !this.isFormatSwitch) {
            return;
        }

        const validate = () => {
            const checkValidity = (): [
                boolean,
                string | undefined,
                number[],
                string,
            ] => {
                const captures = Object.values(this.rule.regex.captures);
                console.info('Captures', { ...this.rule.regex.captures });

                // No field is captured
                if (captures.every((group) => group === '')) {
                    return [
                        false,
                        'error',
                        captures.map((_, idx) => idx),
                        'At least one field needs to be captured',
                    ];
                }

                // Fields set by non-existing capture group
                const tooHighCaptures = captures
                    .map((capture, idx) => ({ capture, idx }))
                    .filter(
                        ({ capture }) =>
                            capture !== '' && Number(capture) > nGroups
                    )
                    .map(({ idx }) => idx);

                if (tooHighCaptures.length > 0) {
                    return [
                        true,
                        'warning',
                        tooHighCaptures,
                        `One or more fields are set by non-existing capture group (regex has ${nGroups} groups)`,
                    ];
                }

                // Fields are captured by the same capture group
                const duplicateCaptures = captures
                    .map((capture, idx) => ({ capture, idx }))
                    .filter(
                        ({ capture }) =>
                            capture !== '' &&
                            captures.indexOf(capture) !==
                                captures.lastIndexOf(capture)
                    )
                    .map(({ idx }) => idx);

                if (duplicateCaptures.length > 0) {
                    return [
                        true,
                        'warning',
                        duplicateCaptures,
                        `Two or more fields are set by the same capture group`,
                    ];
                }

                return [true, undefined, [], 'Valid capture groups!'];
            };

            // Check whether the name is valid and setting possible error/warning messages
            const [isValid, type, indices, message] = checkValidity();

            if (type !== undefined) {
                regexWarningEl.addClass(type);
                regexWarningEl.setText(message);

                Object.values(settings)
                    .filter((_, idx) => indices.includes(idx))
                    .forEach((setting) => {
                        setting.nameEl.addClass(type);
                        setting.controlEl.addClass(type);
                        setting.controlEl
                            .querySelector('select')
                            ?.addClass(type);
                    });
            } else {
                regexWarningEl.addClass('error', 'warning');
                regexWarningEl.setText('');

                Object.values(settings).forEach((setting) => {
                    setting.nameEl.removeClass('error', 'warning');
                    setting.controlEl
                        .querySelector('select')
                        ?.removeClass('error', 'warning');
                });
            }

            this.isValidFormat = isValid;
            this.validateSaveButton();

            return isValid;
        };

        const captures = this.rule.regex.captures;
        const fields = this.plugin.fields[this.rule.noteType] ?? [];

        for (let idx = 0; idx < fields.length; idx++) {
            const field = fields[idx];
            const group = (captures[field] ??= `${idx + 1}`);

            const setting = new Setting(parent)
                .setName(field)
                .addDropdown((groupDropdown) => {
                    const groups = [''].concat(
                        [...Array(fields.length)].map((_, i) => `${i + 1}`)
                    );

                    groups.forEach((g) =>
                        groupDropdown.addOption(`${g}`, `${g}`)
                    );
                    groupDropdown.setValue(`${group}`);
                    groupDropdown.onChange((newGroup) => {
                        captures[field] = newGroup;
                        this.addCaptureGroups(contentEl);
                    });
                });

            settings[field] = setting;
            setting.settingEl.classList.add('anki-capture-list-item');
        }

        const regexWarningEl = parent.createDiv({
            cls: 'error',
        });

        validate();
    }

    private displayFields(contentEl: HTMLElement) {
        if (this.fieldsDiv === undefined) {
            this.fieldsDiv = contentEl.createDiv();
        }

        const parent = this.fieldsDiv;
        parent.empty();

        const fieldsSection = addSection(
            parent,
            'Fields',
            'Control how and which fields are set from the regex',
            'list'
        );

        fieldsSection.addExtraButton((button) =>
            setupWikiButton(button, 'Exporting#fields')
        );

        new Setting(parent)
            .setName('Override empty?')
            .setDesc(
                `Whether to override fields that are not captured by ${this.rule.type}`
            )
            .addToggle((toggle) => {
                toggle.setValue(this.rule.shouldOverride ?? false);
                toggle.onChange((value) => {
                    this.rule.shouldOverride = value;
                });
            });

        const isDisabled = false;
        new Setting(parent)
            .setName('Obsidian link')
            .setDesc(
                'Select a field to store a link to the note location in Obsidian'
            )
            .addDropdown((dropdown) => {
                const fields = this.plugin.fields[this.rule.noteType] ?? [];
                fields.forEach((type) => dropdown.addOption(type, type));

                dropdown
                    .setValue(this.rule.link.field)
                    .setDisabled(isDisabled)
                    .onChange((field) => {
                        this.rule.link.field = field;
                    });

                dropdown.selectEl.style.minWidth = '70px';
            })

            .addToggle((toggle) => {
                toggle
                    .setValue(this.rule.link.enabled)
                    .setDisabled(isDisabled)
                    .onChange((value) => {
                        this.rule.link.enabled = value;
                    });
            });
    }

    private displayFiles(contentEl: HTMLElement) {
        const filesSection = addSection(contentEl, 'Files', '', 'folder-sync');
        filesSection.addExtraButton((button) =>
            setupWikiButton(button, 'Exporting#files')
        );

        // Folder to scan in for notes to export
        new Setting(contentEl)
            .setName('Search folder')
            .setDesc(
                'Folder to search in for notes to export. If left blank, the entire vault will be searched'
            )
            .addText((text) => {
                new FolderSuggest(this.app, text.inputEl);
                text.setPlaceholder(DEFAULT_EXPORT_RULE.source.folder)
                    .setValue(this.rule.source.folder)
                    .onChange((value) => {
                        this.rule.source.folder = value;
                        this.plugin.save();
                    });
            });

        // File patterns to ignore
        const patternSetting = new Setting(contentEl)
            .setName('File patterns')
            .addTextArea((text) => {
                text.inputEl.rows = 10;
                text.inputEl.cols = 40;

                text.setPlaceholder(
                    DEFAULT_EXPORT_RULE.source.patterns.join('\n')
                )
                    .setValue(this.rule.source.patterns.join('\n'))
                    .onChange((value) => {
                        value = value.trim();
                        const patterns = value === '' ? [] : value.split('\n');

                        this.rule.source.patterns = patterns;
                        this.plugin.save();
                    });
            });

        // Set description
        const desc = new DocumentFragment();
        desc.appendText(
            'Patterns to specify which files to include/exclude from the search. Uses '
        );
        desc.createEl('a', {
            text: 'glob matching',
            href: 'https://www.npmjs.com/package/micromatch#extended-globbing',
            attr: { target: '_blank', rel: 'noopener' },
        });
        desc.appendText(' to describe the patterns');

        patternSetting.setDesc(desc);
    }

    private validateSaveButton() {
        const isValid =
            this.isValidNoteType && this.isValidFormat && this.isValidName;

        this.saveButton?.setDisabled(!isValid);
    }
}
