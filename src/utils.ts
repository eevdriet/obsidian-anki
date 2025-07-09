import { App, FileSystemAdapter } from 'obsidian';

export function objToMap<T>(obj: Record<string, T>): Map<string, T> {
    return new Map(Object.entries(obj));
}

export function mapToObj<T>(map: Map<string, T>): Record<string, T> {
    return Object.fromEntries(map.entries());
}

export function mapPush<T>(map: Map<string, T[]>, key: string, value: T): void {
    map.set(key, [...(map.get(key) ?? []), value]);
}

export function areEqual(
    obj1: Record<string, any>,
    obj2: Record<string, any>
): boolean {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
        return false;
    }

    for (const key of keys1) {
        const val1 = obj1[key];
        const val2 = obj2[key];

        const bothObjects =
            val1 !== null &&
            val2 !== null &&
            typeof val1 === 'object' &&
            typeof val2 === 'object';

        if (bothObjects) {
            if (!areEqual(val1, val2)) {
                return false;
            }
        } else {
            if (val1 !== val2) {
                return false;
            }
        }
    }

    return true;
}

export function getMediaPath(
    app: App,
    file: string,
    link: string
): string | undefined {
    // Get the relative path within the vault
    const relPath = app.metadataCache.getFirstLinkpathDest(link, file)?.path;

    if (!relPath) {
        return undefined;
    }

    return getAbsolutePath(app, relPath);
}

export function getAbsolutePath(app: App, relPath: string) {
    // Get the absolute path w.r.t. the vault location on the file system
    return (app.vault.adapter as FileSystemAdapter).getFullPath(relPath);
}
