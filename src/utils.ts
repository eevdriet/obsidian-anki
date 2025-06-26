export function objToMap<T>(obj: Record<string, T>): Map<string, T> {
    return new Map(Object.entries(obj));
}

export function mapToObj<T>(map: Map<string, T>): Record<string, T> {
    return Object.fromEntries(map.entries());
}

export function mapPush<T>(map: Map<string, T[]>, key: string, value: T): void {
    map.set(key, [...(map.get(key) ?? []), value]);
}
