import AnkiPlugin from 'plugin';
import * as AnkiConnect from 'anki/connect';
import { warnMessage, errorMessage, successMessage, message } from 'common';

export async function sync(plugin: AnkiPlugin) {
    message('Syncing...');

    try {
        // Note types
        const noteTypes = AnkiConnect.getNoteTypes();
        noteTypes
            .then((types) => {
                plugin.noteTypes = types;
            })
            .catch(() => {
                warnMessage('Could not get note types');
            });

        // Decks
        const decks = AnkiConnect.getDecks()
            .then((decks) => {
                plugin.decks = decks;
            })
            .catch(() => {
                warnMessage('Could not get decks');
            });

        // Fields for each note type
        const fields = noteTypes.then(async (types) => {
            return AnkiConnect.getFields(...types)
                .then((fields) => {
                    plugin.fields = fields;
                })
                .catch(() => {
                    warnMessage('Could not get fields');
                });
        });

        // Cards for each note type
        const cards = noteTypes.then(async (types) => {
            return AnkiConnect.getCardsFromNoteTypes(...types)
                .then((cards) => {
                    plugin.cards = cards;
                })
                .catch(() => {
                    warnMessage('Could not get cards');
                });
        });

        // Save the settings after all Anki data are retrieved
        Promise.all([noteTypes, decks, fields, cards])
            .then(async () => {
                await plugin.save();
                successMessage('Sync');
            })
            .catch(() => {
                errorMessage('Sync');
            });
    } catch (error) {
        errorMessage('Sync');
    }
}
