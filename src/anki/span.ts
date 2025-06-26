export class Span {
    start: number;
    end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }

    static fromMatch(match: RegExpMatchArray): Span {
        const start = match.index!;
        const end = start + match[0].length;

        return new Span(start, end);
    }

    contains(other: Span): boolean {
        return this.end >= other.start && this.start <= other.end;
    }

    overlaps(other: Span): boolean {
        return this.start < other.end && this.end > other.start;
    }
}

export class MultiSpan {
    private _spans: Span[];

    constructor(spans: Span[] = []) {
        this._spans = [];

        spans.forEach((span) => {
            this.merge(span);
        });
    }

    get start() {
        return this._spans.at(0)?.start;
    }
    get end() {
        return this._spans.at(-1)?.end;
    }

    contains(other: Span | MultiSpan): boolean {
        if (other instanceof Span) {
            return this._spans.some((span) => span.contains(other));
        }

        if (other instanceof MultiSpan) {
            return this._linearSearch(other, (a, b) => a.contains(b));
        }

        return false;
    }

    overlaps(other: Span | MultiSpan): boolean {
        if (other instanceof Span) {
            return this._spans.some((span) => span.overlaps(other));
        }

        if (other instanceof MultiSpan) {
            return this._linearSearch(other, (a, b) => a.overlaps(b));
        }

        return false;
    }

    merge(other: Span) {
        this._spans.push(other);
        this._normalize();
    }

    clear() {
        this._spans = [];
    }

    private _normalize(): void {
        this._spans.sort((a, b) => a.start - b.start);
        const result: Span[] = [];

        for (const span of this._spans) {
            const last = result[result.length - 1];
            if (last && last.overlaps(span)) {
                result[result.length - 1] = new Span(
                    Math.min(last.start, span.start),
                    Math.max(last.end, span.end)
                );
            } else {
                result.push(span);
            }
        }

        this._spans = result;
    }

    private _linearSearch(
        other: MultiSpan,
        predicate: (left: Span, right: Span) => boolean
    ) {
        let l = 0;
        let r = 0;

        while (l < this._spans.length && r < other._spans.length) {
            const left = this._spans[l];
            const right = other._spans[r];

            if (predicate(left, right)) {
                return true;
            }

            // Advance the one that ends first
            if (left.end < right.end) {
                l++;
            } else {
                r++;
            }
        }

        return false;
    }
}
