import { ANKI_CONNECT_URL, warnMessage } from 'common';
import { CardInfo } from './card';
import { AnkiAddNote, AnkiNoteInfo, AnkiUpdateNote, Note } from './note';

export type AnkiRequest = {
    action: string;
    version: 6;
    params: Record<string, any>;
};

export interface AnkiResponse<T> {
    error: string | null;
    result: T;
}

export interface AnkiMultiResponse<T extends unknown[]> {
    error: string | null;
    result: { [K in keyof T]: AnkiResponse<T[K]> };
}

/**
 * @param request - Request to invoke to Anki
 * @returns AnkiConnect response
 */
export function invoke<T>(request: AnkiRequest): Promise<T> {
    const requestStr = JSON.stringify(request, null, 4);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.onerror = () => {
            reject(`Failed to issue request`);
        };

        xhr.onload = () => {
            try {
                const response = JSON.parse(
                    xhr.responseText
                ) as AnkiResponse<T>;

                if (Object.getOwnPropertyNames(response).length != 2) {
                    throw 'response has an unexpected number of fields';
                }
                if (!response.hasOwnProperty('error')) {
                    throw 'response is missing required error field';
                }
                if (!response.hasOwnProperty('result')) {
                    throw 'response is missing required result field';
                }
                if (response.error) {
                    throw response.error;
                }

                resolve(response.result);
            } catch (error) {
                reject(error);
            }
        };

        xhr.open('POST', ANKI_CONNECT_URL);
        xhr.send(requestStr);
    });
}

export function parse<T>(response: AnkiResponse<T>): T {
    return response.result;
}

export function createRequest(action: string, params = {}): AnkiRequest {
    return { action, version: 6, params };
}

export async function multi<T>(actions: AnkiRequest[]): Promise<T[]> {
    const request = createRequest('multi', { actions });
    const response = invoke(request);

    return response.then((results: AnkiResponse<T>[]) => {
        return results.map((result) => {
            if (result.error) {
                warnMessage(`${result.error}`);
            }

            return result.result;
        });
    });
}

/*
 * Getters for Anki properties such as note types, fields etc.
 */

export async function getNoteTypes(): Promise<string[]> {
    const request = createRequest('modelNames');
    return invoke(request);
}

export async function getDecks(): Promise<string[]> {
    const request = createRequest('deckNames');
    return invoke(request);
}

export async function getFields(
    ...modelNames: string[]
): Promise<Record<string, string[]>> {
    const requests = modelNames.map((modelName) =>
        createRequest('modelFieldNames', { modelName })
    );

    const responses = await multi<string[]>(requests);
    const result: Record<string, string[]> = {};

    modelNames.forEach((name, idx) => {
        result[name] = responses[idx];
    });

    return result;
}

export async function getCardsFromNoteTypes(
    ...modelNames: string[]
): Promise<Record<string, string[]>> {
    const requests = modelNames.map((modelName) =>
        createRequest('modelTemplates', { modelName })
    );

    const responses = await multi<string[]>(requests);
    const result: Record<string, string[]> = {};

    modelNames.forEach((name, idx) => {
        result[name] = Object.keys(responses[idx]);
    });

    return result;
}

export async function getCardsInfo(...cards: number[]): Promise<CardInfo[]> {
    const request = createRequest('cardsInfo', { cards });
    return invoke(request);
}

/*
 * Modifiers
 */
export async function createDecks(...decks: string[]): Promise<number[]> {
    const requests = decks.map((deck) => createRequest('createDeck', { deck }));

    return multi(requests);
}

/*
 * Note creation, modificiation and deletion
 */
export async function createNotes(...notes: AnkiAddNote[]): Promise<number[]> {
    const requests = notes.map((note) => createRequest('addNote', { note }));

    return multi(requests);
}

export async function updateNotes(...notes: AnkiUpdateNote[]): Promise<null[]> {
    const requests = notes.map((note) => createRequest('updateNote', { note }));

    return multi(requests);
}

export async function deleteNotes(...notes: number[]): Promise<null> {
    const request = createRequest('deleteNotes', { notes });

    return invoke(request);
}

export async function getNotes(query: string): Promise<AnkiNoteInfo[]> {
    const request = createRequest('notesInfo', { query });

    return invoke(request);
}
