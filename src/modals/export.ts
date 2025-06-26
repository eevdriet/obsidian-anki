import { PRIMARY_BUTTON_CLASS } from 'common';
import AnkiModal, { validateTemplate } from 'modals';
import {
    ButtonComponent,
    DropdownComponent,
    Setting,
    TextAreaComponent,
    TextComponent,
} from 'obsidian';
import AnkiPlugin from 'plugin';
import { getRegex101URL } from 'regex';
import { DEFAULT_EXPORT_RULE, ExportType, ExportRule } from 'settings/export';
import { addSection } from 'modals';
import { FolderSuggest, TextSuggest } from './suggest';

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
        this.addExportFormat(contentEl);
        this.displayFields(contentEl);
        this.displayFiles(contentEl);
    }

    private displayHeader(contentEl: HTMLElement) {
        const action = this.initialName === '' ? 'Create' : 'Edit';
        contentEl.createEl('h1', { text: `${action} exporter` });

        const section = addSection(contentEl, 'General', '', 'cog');
        section.addButton((button) => {
            this.saveButton = button;
            button
                .setButtonText('Save')
                .setClass(PRIMARY_BUTTON_CLASS)
                .onClick(async () => {
                    await this.onSave();
                    this.close();
                });

            this.validateSaveButton();
        });
    }

    private displayName(contentEl: HTMLElement) {
        let name: TextComponent;

        const validate = () => {
            const value = name.getValue();
            const isValid = !(value === undefined || value === '');

            if (!isValid) {
                name.inputEl.addClass('error');
                nameWarningEl.addClass('error');
                nameWarningEl.setText('Name cannot be empty!');
            } else if (
                value !== this.initialName &&
                Object(this.rules).hasOwnProperty(value)
            ) {
                name.inputEl.addClass('warning');
                nameWarningEl.addClass('warning');
                nameWarningEl.setText(
                    'Rule with this name already exists! Only save if you want to override it'
                );
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
                    }
                });
            });

        const noteWarningEl = contentEl.createEl('div', {
            cls: 'error',
            text: '',
        });

        validate();
    }

    private addExportFormat(contentEl: HTMLElement) {
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
            'Whether to import all notes into a folder or a single file',
            'pencil'
        );

        formatSection.addDropdown((dropdown) => {
            dropdown
                .addOptions({
                    template: 'Template',
                    regex: 'Regular expression',
                })
                .setValue(this.rule.type)
                .onChange((format: ExportType) => {
                    this.rule.type = format;
                    this.addExportFormat(contentEl);
                });
        });

        switch (this.rule.type) {
            case 'template':
                this.addTemplateExport(parentEl);
                break;
            case 'regex':
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

        const templateTextEl = new Setting(contentEl).addTextArea((text) => {
            templateInput = text;
            text.inputEl.rows = 10;
            text.inputEl.cols = 220;

            text.setPlaceholder('Template')
                .setValue(this.rule.template.format)
                .onChange((value) => {
                    this.rule.template.format = value;
                    validate();
                });
        });

        templateTextEl.controlEl.style.width = '100%';
        templateTextEl.settingEl.style.margin = '0px';

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

                const groups = [
                    ...regex.source.matchAll(/(?<!\\)(\()(?!\?:)/g),
                ];
                if (groups.length === 0) {
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

        const regexTextEl = new Setting(contentEl).addTextArea((text) => {
            regexInput = text;

            text.inputEl.rows = 5;
            text.inputEl.cols = 220;

            text.setPlaceholder('Regular expression');
            text.onChange((value) => {
                validate();

                this.rule.regex.format = value;
                this.displayFields(contentEl);
            });
            text.setValue(this.rule.regex.format);
        });

        regexTextEl.controlEl.style.width = '100%';
        regexTextEl.settingEl.style.margin = '0px';

        const regexWarningEl = contentEl.createDiv({
            cls: 'error',
        });

        const decks = this.plugin.decks ?? [];

        new Setting(contentEl)
            .setName('Deck')
            .setDesc(
                'Deck to export notes to when no deck is specified for the exporter rule'
            )
            .addText((text) => {
                new TextSuggest(this.app, text.inputEl, decks);
                text.setPlaceholder(DEFAULT_EXPORT_RULE.regex.deck)
                    .setValue(this.rule.regex.deck)
                    .onChange((value) => {
                        this.rule.regex.deck = value;
                        this.plugin.save();
                    });
            });

        new Setting(contentEl)
            .setName('Captures')
            .setDesc(
                'Map the fields of the note type to a specific capture group'
            )
            .addExtraButton((button) => {
                button
                    .setIcon('plus')
                    .setTooltip('Add new field capture')
                    .onClick(() => {
                        this.rule.regex.captures[0] = '';
                        this.addCaptures(contentEl);
                    });
            });

        this.addCaptures(contentEl);
        validate();
    }

    private displayFields(contentEl: HTMLElement) {
        if (this.fieldsDiv === undefined) {
            this.fieldsDiv = contentEl.createDiv();
        }

        const parent = this.fieldsDiv;
        parent.empty();

        addSection(
            parent,
            'Fields',
            'Control how and which fields are set from the regex',
            'list'
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

    private addCaptures(contentEl: HTMLElement) {
        const captures = this.rule.regex.captures;

        if (this.capturesDiv === undefined) {
            this.capturesDiv = contentEl.createDiv();
        }

        const parent = this.capturesDiv;
        parent.empty();

        for (const [group, field] of Object.entries(captures)) {
            console.info(`\t'${group}': '${field}'`);
            const setting = new Setting(parent);

            setting
                .addDropdown((groupDropdown) => {
                    const groups = [...Array(10)].map((_, i) => i + 1);

                    groups.forEach((group) =>
                        groupDropdown.addOption(`${group}`, `${group}`)
                    );
                    groupDropdown.setValue(group);
                    groupDropdown.onChange((newGroup) => {
                        delete captures[+group];
                        captures[+newGroup] = field;
                        this.addCaptures(contentEl);
                    });
                })
                .addDropdown((fieldDropdown) => {
                    const fields = this.plugin.fields[this.rule.noteType] ?? [];

                    fields.forEach((type) =>
                        fieldDropdown.addOption(type, type)
                    );
                    fieldDropdown.setValue(field);
                    fieldDropdown.onChange((value) => {
                        captures[+group] = value;
                        this.addCaptures(contentEl);
                    });
                })
                .addExtraButton((button) =>
                    button
                        .setTooltip('Delete field capture')
                        .setIcon('cross')
                        .onClick(() => {
                            delete captures[+group];
                            this.addCaptures(contentEl);
                        })
                );
        }
    }

    private displayFiles(contentEl: HTMLElement) {
        addSection(contentEl, 'Files', '', 'folder-sync');

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
