import { App, Modal, PluginSettingTab, setIcon, Setting } from 'obsidian';

import AnkiPlugin from 'plugin';
import ExportModal from 'modals/export';
import ImportModal from 'modals/import';
import { sync } from 'anki/sync';
import { PLUGIN, PRIMARY_BUTTON_CLASS, WIKI_URL } from 'common';
import { addSection, setupWikiButton } from 'modals';
import { DEFAULT_SETTINGS } from 'settings';
import { ImportRule } from './import';
import { ExportRule } from './export';

export default class AnkiPluginSettingTab extends PluginSettingTab {
    plugin: AnkiPlugin;

    constructor(app: App, plugin: AnkiPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        // Create header
        containerEl.createEl('h1', { text: PLUGIN });

        this.addWelcomeWord(containerEl);
        this.addSyncSettings(containerEl);
        this.addImportSettings(containerEl);
        this.addExporters(containerEl);
    }

    addWelcomeWord(containerEl: HTMLElement): void {
        const header = containerEl.createEl('div');
        header.appendText(
            "Welcome! Here you can configure your own rules to sync your notes between Anki and Obsidian. If you're unsure on how to use the plugin you can check out the "
        );
        header.createEl('a', {
            text: 'wiki',
            href: WIKI_URL,
            attr: { target: '_blank', rel: 'noopener' },
        });
        header.appendText(' by clicking on the ');

        const infoIcon = header.createSpan();
        setIcon(infoIcon, 'info');

        header.appendText(' icons next to the various settings');

        header.style.marginBottom = '1.5em';
    }

    addSyncSettings(containerEl: HTMLElement): void {
        const section = addSection(
            containerEl,
            'Sync on startup',
            'Whether to sync with and import/export notes between Anki and Obsidian',
            'refresh-cw'
        );

        section
            .addExtraButton((button) => setupWikiButton(button, 'Syncing'))
            .addExtraButton((button) => {
                button
                    .setIcon('refresh-cw')
                    .setTooltip('Sync now')
                    .onClick(async () => {
                        sync(this.plugin);
                    });
            });

        const syncSettings = this.plugin.settings.onload;

        new Setting(containerEl)
            .setName('Anki data?')
            .setDesc('Note types, decks, cards, fields etc.')
            .addToggle((toggle) => {
                toggle.setValue(syncSettings.sync).onChange((value) => {
                    syncSettings.sync = value;
                    this.plugin.save();
                });
            });

        // Import on startrup
        new Setting(containerEl).setName('Import?').addToggle((toggle) => {
            toggle.setValue(syncSettings.import).onChange((value) => {
                syncSettings.import = value;
                this.plugin.save();
            });
        });

        // Export on startrup
        new Setting(containerEl).setName('Export?').addToggle((toggle) => {
            toggle.setValue(syncSettings.export).onChange((value) => {
                syncSettings.export = value;
                this.plugin.save();
            });
        });
    }

    addImportSettings(containerEl: HTMLElement): void {
        const importHeading = addSection(
            containerEl,
            'Import',
            'Custom rules to import notes from Anki into Obsidian based on field templates',
            'arrow-down-to-line'
        );

        const importersDiv = containerEl.createEl('div', {
            cls: 'setting-item',
        });
        const importRules = this.plugin.settings.import.rules;

        // New rule button
        importHeading
            .addExtraButton((button) => setupWikiButton(button, 'Importing'))
            .addExtraButton((button) => {
                button
                    .setIcon('arrow-down-to-line')
                    .setTooltip('Import now')
                    .onClick(async () => {
                        this.plugin.importer.import();
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText('New rule')
                    .setCta()
                    .onClick(() => {
                        const formModal = new ImportModal(
                            'New rule',
                            this.plugin,
                            () => {
                                this.drawRules(
                                    importersDiv,
                                    importRules,
                                    ImportModal
                                );
                            }
                        );
                        formModal.open();
                    });
            });

        this.drawRules(importersDiv, importRules, ImportModal);
    }

    addExporters(containerEl: HTMLElement): void {
        // Rules
        const exportHeading = addSection(
            containerEl,
            'Export',
            'Custom rules to export notes from Obsidian into Anki based on field templates or regular expressions',
            'arrow-up-from-line'
        );

        const exportersDiv = containerEl.createEl('div', {
            cls: 'setting-item',
        });
        const exportRules = this.plugin.settings.export.rules;

        // Add new rule button
        exportHeading
            .addExtraButton((button) => setupWikiButton(button, 'Exporting'))
            .addExtraButton((button) => {
                button
                    .setIcon('arrow-up-from-line')
                    .setTooltip('Export now')
                    .onClick(async () => {
                        this.plugin.exporter.export();
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText('New rule')
                    .setCta()
                    .onClick(() => {
                        const formModal = new ExportModal(
                            'New rule',
                            this.plugin,
                            () => {
                                this.drawRules(
                                    exportersDiv,
                                    exportRules,
                                    ExportModal
                                );
                            }
                        );
                        formModal.open();
                    });
            });

        this.drawRules(exportersDiv, exportRules, ExportModal);

        // this.drawExportFileSettings(containerEl);
    }

    drawExportFileSettings(containerEl: HTMLElement) {
        const createDesc = (header: string, type: string, value: string) => {
            const desc = new DocumentFragment();
            desc.appendText(
                `Determines how a file comment sets ${type} for all following notes.`
            );
            desc.createEl('br');
            desc.appendText('For example, ');
            desc.createEl('em', {
                text: header,
            });
            desc.appendText(
                ` sets ${type} for the notes with the following comment: `
            );
            desc.createEl('br');
            desc.createEl('em', {
                text: `<!-- ${header}: ${value} -->`,
            });

            return desc;
        };

        new Setting(containerEl)
            .setName('File deck')
            .setDesc(createDesc('File deck', 'the deck', '<DECK>'))
            .addText((text) => {
                text.setValue(this.plugin.settings.export.fileDeckComment)
                    .setPlaceholder(DEFAULT_SETTINGS.export.fileDeckComment)
                    .onChange((comment) => {
                        this.plugin.settings.export.fileDeckComment = comment;
                    });
            });

        new Setting(containerEl)
            .setName('File tags')
            .setDesc(createDesc('File tags', 'the tags', '<TAGS>'))
            .addText((text) => {
                text.setValue(this.plugin.settings.export.fileTagsComment)
                    .setPlaceholder(DEFAULT_SETTINGS.export.fileTagsComment)
                    .onChange((comment) => {
                        this.plugin.settings.export.fileTagsComment = comment;
                    });
            });
    }

    drawRules<T extends Modal>(
        containerEl: HTMLElement,
        rules: Record<string, ImportRule | ExportRule>,
        C: new (...args: any) => T
    ) {
        containerEl.style.flexDirection = 'column';
        containerEl.empty();

        const redraw = () => {
            this.drawRules(containerEl, rules, C);
        };

        const names = [...Object.entries(rules)]
            .sort((a, b) => {
                const [name1, rule1] = a;
                const [name2, rule2] = b;

                // Sort by flag: true first
                if (rule1.enabled !== rule2.enabled) {
                    return rule1.enabled ? -1 : 1;
                }

                // Then sort by key lexicographically
                return name1.localeCompare(name2);
            })
            .map(([name, _]) => name);

        names.forEach((name) => {
            const enabled = rules[name].enabled;
            const setting = new Setting(containerEl)
                .setName(name)
                // Edit
                .addExtraButton((button) => {
                    button.onClick(() => {
                        const formModal = new C(name, this.plugin, redraw);
                        formModal.open();
                    });
                    button.setIcon('pencil');
                    button.setTooltip('Edit rule');
                })
                // Copy
                .addExtraButton((button) => {
                    button.onClick(() => {
                        const copyName = `${name} (copy)`;
                        const copyRule = { ...rules[name] };
                        rules[copyName] = copyRule;

                        this.plugin.save();
                        redraw();
                    });
                    button.setIcon('copy');
                    button.setTooltip('Copy rule');
                })
                // Toggle
                .addExtraButton((button) => {
                    if (enabled) {
                        button.extraSettingsEl.classList.add('enabled-button');
                    } else {
                        button.extraSettingsEl.classList.remove(
                            'enabled-button'
                        );
                    }

                    button
                        .setIcon('circle-power')
                        .setTooltip('Toggle enabled')
                        .onClick(() => {
                            rules[name].enabled = !enabled;
                            this.drawRules(containerEl, rules, C);
                        });
                })
                // Delete
                .addExtraButton((button) => {
                    button.onClick(() => {
                        delete rules[name];
                        this.plugin.save();
                        redraw();
                    });
                    button.setIcon('cross');
                    button.setTooltip('Remove rule');
                });

            setting.settingEl.style.width = '100%';
            setting.settingEl.style.marginInlineEnd = '0px';
            setting.settingEl.style.borderStyle = 'none';

            // Whether the rule is enabled
            setting.nameEl.classList.toggle('enabled-rule', !enabled);
        });

        if (names.length === 0) {
            containerEl.createDiv({
                text: 'No rules defined yet',
            });
        }
    }
}
