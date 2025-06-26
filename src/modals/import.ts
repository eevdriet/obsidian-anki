import { PLUGIN, PRIMARY_BUTTON_CLASS } from 'common';
import AnkiModal, { validateTemplate } from 'modals';
import {
    ButtonComponent,
    DropdownComponent,
    Setting,
    TextAreaComponent,
    TextComponent,
} from 'obsidian';
import AnkiPlugin from 'plugin';
import {
    DEFAULT_IMPORT_RULE,
    ExistingAction,
    ImportRule,
    ImportType,
} from 'settings/import';
import { FileSuggest, FolderSuggest } from './suggest';
import { addSection } from 'modals';

export default class ImportModal extends AnkiModal {
    initialName: string;
    currName: string;

    rule: ImportRule;
    defaultRule: ImportRule;
    rules: Record<string, ImportRule>;

    isValidName: boolean = true;
    isValidNoteType: boolean = true;
    isValidTemplate: boolean = true;
    isValidFolderFileFormat: boolean = true;

    templateDiv?: HTMLElement;
    importDiv?: HTMLElement;
    saveButton?: ButtonComponent;

    constructor(name: string, plugin: AnkiPlugin, onSaveCallback: () => void) {
        super(plugin, onSaveCallback);

        this.plugin = plugin;
        this.initialName = name;
        this.currName = name;

        this.rules = this.plugin.settings.import.rules;
        this.rule = this.rules[name] ?? { ...DEFAULT_IMPORT_RULE };
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
        this.displayQuery(contentEl);
        this.displayTemplate(contentEl);
        this.displayTag(contentEl);

        this.displayDuplicate(contentEl);

        this.displayDestination(contentEl);
    }

    private displayHeader(contentEl: HTMLElement) {
        const action = this.initialName === '?' ? 'Create' : 'Edit';
        contentEl.createEl('h1', { text: `${action} importer` });

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
        });

        this.validateSaveButton();
    }

    private displayName(contentEl: HTMLElement) {
        let nameInput: TextComponent;

        const validate = () => {
            const value = nameInput.getValue();

            const isValid = value !== undefined && value !== '';
            if (isValid) {
                nameInput.inputEl.removeClass('error');
                nameWarningEl.setText('');
            } else {
                nameInput.inputEl.addClass('error');
                nameWarningEl.setText('Name cannot be empty!');
            }

            this.isValidName = isValid;
            this.validateSaveButton();

            return isValid;
        };

        new Setting(contentEl)
            .setName('Name')
            .setDesc('Name of the rule to apply')
            .addText((text) => {
                nameInput = text;

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

        const nameWarningEl = contentEl.createEl('div', {
            cls: 'error',
            text: '',
        });

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
            .setDesc('Select the note type to importer')
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
                        this.displayTemplate(contentEl);
                        this.displayDestinationOptions(contentEl);
                    }
                });
            });

        const noteWarningEl = contentEl.createEl('div', {
            cls: 'error',
            text: '',
        });

        validate();
    }

    private displayQuery(contentEl: HTMLElement) {
        const setting = new Setting(contentEl)
            .setName('Query')
            .addText((text) => {
                text.setValue(this.rule.query).onChange((query) => {
                    this.rule.query = query;
                });
            });

        const desc = new DocumentFragment();
        desc.appendText('Query to find notes from Anki');
        desc.createEl('br');
        desc.appendText('Use the ');
        desc.createEl('a', {
            text: 'official Anki documentation',
            href: 'https://docs.ankiweb.net/searching.html',
            attr: { target: '_blank', rel: 'noopener' },
        });
        desc.appendText(' to learn how to construct a valid query');

        setting.setDesc(desc);
    }

    private displayTemplate(contentEl: HTMLElement) {
        if (this.templateDiv === undefined) {
            this.templateDiv = contentEl.createDiv();
        }

        const parentEl = this.templateDiv;
        parentEl.empty();

        // Header
        addSection(
            parentEl,
            'Template',
            'Write the template to import Anki notes',
            'pencil'
        );

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

            this.isValidTemplate = isValid;
            this.validateSaveButton();
        };

        const templateTextEl = new Setting(parentEl).addTextArea((text) => {
            templateInput = text;
            text.inputEl.rows = 10;
            text.inputEl.cols = 220;

            text.setPlaceholder('Template')
                .setValue(this.rule.template)
                .onChange((value) => {
                    this.rule.template = value;
                    validate();
                });
        });

        templateTextEl.controlEl.style.width = '100%';
        templateTextEl.settingEl.style.margin = '0px';

        const templateWarningEl = parentEl.createDiv({
            cls: 'error',
        });
        templateWarningEl.style.whiteSpace = 'pre-wrap';

        validate();
    }

    private displayTag(contentEl: HTMLElement) {
        // Tag settings
        const section = addSection(
            contentEl,
            'Tags',
            `Whether to add a tag to imported flashcards to signify the notes are generated by ${PLUGIN}`,
            'tag'
        );

        section
            .addToggle((toggle) => {
                toggle.setValue(this.rule.tag.enabled).onChange((value) => {
                    this.rule.tag.enabled = value;
                });
            })
            .addText((text) => {
                text.setPlaceholder(DEFAULT_IMPORT_RULE.tag.format)
                    .setValue(this.rule.tag.format)
                    .onChange((value) => {
                        this.rule.tag.format = value;
                    });
            });
    }

    private displayDuplicate(contentEl: HTMLElement) {
        // Tag settings
        const section = addSection(
            contentEl,
            'Existing notes',
            '',
            'square-stack'
        );
        const desc = new DocumentFragment();
        desc.appendText('How to handle notes that have already been imported');

        const ul = desc.createEl('ul');
        const options = [
            ['Ignore', 'Do not import the note again'],
            [
                'Update',
                'Update the existing note with the latest version from Anki',
            ],
            [
                'Append',
                'Add the latest version from Anki and leave the existing version',
            ],
        ];
        for (const [option, explain] of options) {
            const li = desc.createEl('li');

            const strong = desc.createEl('strong', { text: option });
            li.appendChild(strong);
            li.appendText(`: ${explain}`);
            ul.appendChild(li);
        }

        section.setDesc(desc);

        section.addDropdown((dropdown) => {
            dropdown
                .addOptions({
                    ignore: 'Ignore',
                    update: 'Update',
                    append: 'Append',
                })
                .setValue(this.rule.existingAction)
                .onChange((action: ExistingAction) => {
                    this.rule.existingAction = action;
                });
        });
    }

    private displayDestination(contentEl: HTMLElement) {
        // Header
        const section = addSection(
            contentEl,
            'Destination',
            'Whether to import all notes into a folder or a single file',
            'folder-output'
        );

        section.addDropdown((dropdown) => {
            dropdown
                .addOptions({ folder: 'Folder', file: 'File' })
                .setValue(this.rule.type)
                .onChange((type: ImportType) => {
                    this.rule.type = type;
                    this.displayDestinationOptions(contentEl);
                });
        });

        this.displayDestinationOptions(contentEl);

        // Add the notes at the end of a section
        new Setting(contentEl)
            .setName('Insert after')
            .setDesc(
                'Insert the notes after the specified line. If disabled, the notes are placed at the end of the file'
            )
            .addText((text) => {
                text.setPlaceholder(DEFAULT_IMPORT_RULE.insertAfter.format)
                    .setValue(this.rule.insertAfter.format)
                    .onChange((value) => {
                        this.rule.insertAfter.format = value;
                    });
            })
            .addToggle((toggle) => {
                toggle
                    .setValue(this.rule.insertAfter.enabled)
                    .onChange((value) => {
                        this.rule.insertAfter.enabled = value;
                        this.displayDestinationOptions(contentEl);
                    });
            });
    }

    private displayDestinationOptions(contentEl: HTMLElement) {
        if (this.importDiv === undefined) {
            this.importDiv = contentEl.createEl('div', {
                cls: 'setting-item',
            });
            this.importDiv.style.display = 'block';
        }

        const parentEl = this.importDiv;
        parentEl.empty();

        switch (this.rule.type) {
            case 'folder':
                this.displayFolderImport(parentEl);
                break;
            default:
                this.displayFileImport(parentEl);
                break;
        }
    }

    private displayFolderImport(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName('Folder')
            .setDesc('Folder to import the notes into')
            .addText((text) => {
                new FolderSuggest(this.app, text.inputEl);
                text.setPlaceholder(DEFAULT_IMPORT_RULE.folder.path)
                    .setValue(this.rule.folder.path)
                    .onChange((value) => {
                        this.rule.folder.path = value;
                    });
            });

        let fileNameInput: TextComponent;

        const validate = () => {
            const value = fileNameInput?.getValue() ?? '';
            const noteFields = this.plugin.fields
                ? this.plugin.fields[this.rule.noteType]
                : [];

            const [isValid, message] = validateTemplate(value, noteFields);
            if (!isValid) {
                fileNameInput.inputEl.addClass('error');
                fileNameWarningEl.setText(message);
            } else {
                fileNameInput.inputEl.removeClass('error');
                fileNameWarningEl.setText('');
            }

            this.isValidFolderFileFormat = isValid;
            this.validateSaveButton();
        };

        new Setting(contentEl)
            .setName('File name format')
            .setDesc(
                'Format of the file name for each note. Should be based on a field that is unique to each note'
            )
            .addText((text) => {
                fileNameInput = text;

                text.setPlaceholder(DEFAULT_IMPORT_RULE.folder.fileFormat)
                    .setValue(this.rule.folder.fileFormat)
                    .onChange((value) => {
                        validate();
                        this.rule.folder.fileFormat = value;
                    });
            });

        const fileNameWarningEl = contentEl.createDiv({
            cls: 'error',
        });
        fileNameWarningEl.style.whiteSpace = 'pre-wrap';

        validate();
    }

    private displayFileImport(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName('File')
            .setDesc('File to import the notes into')
            .addText((text) => {
                new FileSuggest(this.app, text.inputEl);
                text.setPlaceholder(DEFAULT_IMPORT_RULE.file.path)
                    .setValue(this.rule.file.path)
                    .onChange((value) => {
                        this.rule.file.path = value;
                    });
            });
    }

    private validateSaveButton() {
        let isValid = this.isValidNoteType && this.isValidTemplate;
        isValid &&= this.rule.type !== 'folder' || this.isValidFolderFileFormat;

        this.saveButton?.setDisabled(!isValid);
    }
}
