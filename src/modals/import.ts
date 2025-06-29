import { message, PLUGIN } from 'common';
import AnkiModal, {
    setupWikiButton,
    validate,
    validateName,
    validateNoteType,
    validateTemplate,
    Validity,
} from 'modals';
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
import { valid } from 'node-html-parser';

export default class ImportModal extends AnkiModal {
    name: string;
    origName: string;

    rule: ImportRule;
    rules: Record<string, ImportRule>;

    templateDiv?: HTMLElement;
    importDiv?: HTMLElement;

    isValidName: boolean = true;
    isValidNoteType: boolean = true;
    isValidTemplate: boolean = true;
    isValidFolderFileFormat: boolean = true;

    saveButton?: ButtonComponent;

    constructor(name: string, plugin: AnkiPlugin, onSaveCallback: () => void) {
        super(plugin, onSaveCallback);
        this.name = name;
        this.origName = name;

        this.rules = this.plugin.settings.import.rules;
        this.rule = this.rules[this.name] ?? { ...DEFAULT_IMPORT_RULE };
    }

    override async onClose(): Promise<void> {
        delete this.rules[this.origName];
        this.rules[this.name] = this.rule;

        super.onClose();
    }

    override display() {
        const { contentEl } = this;
        contentEl.empty();

        this.displayGeneral(contentEl);

        this.displayName(contentEl);
        this.displayNoteType(contentEl);
        this.displayQuery(contentEl);
        this.displayTemplate(contentEl);
        this.displayTag(contentEl);

        this.displayDuplicate(contentEl);
        this.displayDestination(contentEl);

        this.validateSaveButton();
    }

    private displayGeneral(contentEl: HTMLElement) {
        const action = this.origName === '?' ? 'Create' : 'Edit';
        contentEl.createEl('h1', { text: `${action} importer` });

        const section = addSection(contentEl, 'General', '', 'cog');

        section
            .addButton((button) => {
                button
                    .setButtonText('Save')
                    .setTooltip('Save')
                    .setCta()
                    .onClick(() => {
                        delete this.rules[this.origName];
                        this.rules[this.name] = this.rule;

                        message(`${this.name} saved!`);
                    });
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Importing#general')
            );
    }

    private displayName(contentEl: HTMLElement) {
        let nameInput: TextComponent;

        const validateRuleName = () =>
            validate(
                () =>
                    validateName(
                        nameInput.getValue(),
                        this.origName,
                        Object.keys(this.rules)
                    ),
                messageEl,
                nameInput.inputEl,
                setting.nameEl
            );

        const setting = new Setting(contentEl)
            .setName('Name')
            .setDesc('Name of the rule to apply')
            .addText((text) => {
                nameInput = text;

                const type = this.rule.noteType;
                const placeholder =
                    type === '' || type === undefined ? 'New rule' : type;

                text.setPlaceholder(placeholder)
                    .setValue(this.name)
                    .onChange((value) => {
                        const isValid = validateRuleName();

                        if (isValid) {
                            this.name = value;
                        }
                    });
            });

        const messageEl = contentEl.createEl('div', {
            cls: 'setting-message-item',
        });

        validateRuleName();
    }

    private displayNoteType(contentEl: HTMLElement) {
        // Select note type
        let noteTypeInputEl: DropdownComponent;

        const validateType = () =>
            validate(
                () => validateNoteType(noteTypeInputEl.getValue()),
                messageEl,
                noteTypeInputEl.selectEl,
                setting.nameEl
            );

        const setting = new Setting(contentEl)
            .setName('Note type')
            .setDesc('Select the note type to importer')
            .addDropdown((dropdown) => {
                noteTypeInputEl = dropdown;

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
                    this.isValidNoteType = validateType();

                    if (this.isValidNoteType) {
                        this.rule.noteType = value;

                        // Redisplay dependent parts of the modal
                        this.displayTemplate(contentEl);
                        this.displayDestinationOptions(contentEl);
                    }
                });
            });

        const messageEl = contentEl.createEl('div', {
            cls: 'setting-message-item',
        });

        validateType();
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
        const section = addSection(
            parentEl,
            'Template',
            'Write the template to import Anki notes',
            'braces'
        ).addExtraButton((button) => setupWikiButton(button, 'Templates'));

        let templateInput: TextAreaComponent;

        const validateFormat = () =>
            validate(
                () => {
                    const value = templateInput?.getValue() ?? '';
                    const noteFields = this.plugin.fields
                        ? this.plugin.fields[this.rule.noteType]
                        : [];

                    return validateTemplate(value, noteFields, true);
                },
                messageEl,
                templateInput.inputEl,
                section.nameEl
            );

        const setting = new Setting(parentEl).addTextArea((text) => {
            templateInput = text;
            text.inputEl.rows = 10;
            text.inputEl.cols = 220;

            text.setPlaceholder('Template')
                .setValue(this.rule.template)
                .onChange((value) => {
                    this.isValidTemplate = validateFormat();

                    if (this.isValidTemplate) {
                        this.rule.template = value;
                    }
                });
        });

        setting.controlEl.style.width = '100%';
        setting.settingEl.style.margin = '0px';

        const messageEl = parentEl.createDiv({
            cls: 'setting-message-item',
        });
        messageEl.style.whiteSpace = 'pre-wrap';

        this.isValidTemplate = validateFormat();
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
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Importing#tags')
            );
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

        section
            .setDesc(desc)
            .addDropdown((dropdown) => {
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
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Importing#existing-notes')
            );
    }

    private displayDestination(contentEl: HTMLElement) {
        // Header
        const section = addSection(
            contentEl,
            'Destination',
            'Whether to import all notes into a folder or a single file',
            'folder-output'
        );

        section
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({ folder: 'Folder', file: 'File' })
                    .setValue(this.rule.type)
                    .onChange((type: ImportType) => {
                        this.rule.type = type;
                        this.displayDestinationOptions(contentEl);
                    });
            })
            .addExtraButton((button) =>
                setupWikiButton(button, 'Importing#destination')
            );

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

        const validateFileName = () =>
            validate(
                () => {
                    const value = fileNameInput?.getValue() ?? '';
                    const noteFields = this.plugin.fields
                        ? this.plugin.fields[this.rule.noteType]
                        : [];

                    return validateTemplate(value, noteFields, false, true);
                },
                messageEl,
                fileNameInput.inputEl,
                setting.nameEl
            );

        const setting = new Setting(contentEl)
            .setName('File name format')
            .setDesc(
                'Format of the file name for each note. Should be based on a field that is unique to each note'
            )
            .addText((text) => {
                fileNameInput = text;

                text.setPlaceholder(DEFAULT_IMPORT_RULE.folder.fileFormat)
                    .setValue(this.rule.folder.fileFormat)
                    .onChange((value) => {
                        this.isValidFolderFileFormat = validateFileName();

                        if (this.isValidFolderFileFormat) {
                            this.rule.folder.fileFormat = value;
                        }
                    });
            });

        const messageEl = contentEl.createDiv({
            cls: 'setting-message-item',
        });
        messageEl.style.whiteSpace = 'pre-wrap';

        this.isValidFolderFileFormat = validateFileName();
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
        const isValid =
            this.isValidName &&
            this.isValidNoteType &&
            this.isValidTemplate &&
            this.isValidFolderFileFormat;

        this.saveButton?.setDisabled(!isValid);
    }
}
