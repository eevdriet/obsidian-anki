import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { createPopper, Instance as PopperInstance } from '@popperjs/core';
import { App, ISuggestOwner, Scope } from 'obsidian';

class Suggest<T> {
    private owner: ISuggestOwner<T>;
    private values: T[];
    private suggestions: HTMLDivElement[];
    private selectedItem: number;
    private containerEl: HTMLElement;

    constructor(
        owner: ISuggestOwner<T>,
        containerEl: HTMLElement,
        scope: Scope
    ) {
        this.owner = owner;
        this.containerEl = containerEl;

        containerEl.on(
            'click',
            '.suggestion-item',
            this.onSuggestionClick.bind(this)
        );
        containerEl.on(
            'mousemove',
            '.suggestion-item',
            this.onSuggestionMouseover.bind(this)
        );

        scope.register([], 'ArrowUp', (event) => {
            if (!event.isComposing) {
                this.setSelectedItem(this.selectedItem - 1, true);
                return false;
            }
        });

        scope.register([], 'ArrowDown', (event) => {
            if (!event.isComposing) {
                this.setSelectedItem(this.selectedItem + 1, true);
                return false;
            }
        });

        scope.register([], 'Enter', (event) => {
            if (!event.isComposing) {
                this.useSelectedItem(event);
                return false;
            }
        });
    }

    onSuggestionClick(event: MouseEvent, el: HTMLDivElement): void {
        event.preventDefault();

        const item = this.suggestions.indexOf(el);
        this.setSelectedItem(item, false);
        this.useSelectedItem(event);
    }

    onSuggestionMouseover(_event: MouseEvent, el: HTMLDivElement): void {
        const item = this.suggestions.indexOf(el);
        this.setSelectedItem(item, false);
    }

    setSuggestions(values: T[]) {
        this.containerEl.empty();
        const suggestionEls: HTMLDivElement[] = [];

        values.forEach((value) => {
            const suggestionEl = this.containerEl.createDiv('suggestion-item');
            this.owner.renderSuggestion(value, suggestionEl);
            suggestionEls.push(suggestionEl);
        });

        this.values = values;
        this.suggestions = suggestionEls;
        this.setSelectedItem(0, false);
    }

    useSelectedItem(event: MouseEvent | KeyboardEvent) {
        const currentValue = this.values[this.selectedItem];
        if (currentValue) {
            this.owner.selectSuggestion(currentValue, event);
        }
    }

    setSelectedItem(selectedIndex: number, scrollIntoView: boolean) {
        const normalizedIndex = this.wrapAround(
            selectedIndex,
            this.suggestions.length
        );
        const prevSelectedSuggestion = this.suggestions[this.selectedItem];
        const selectedSuggestion = this.suggestions[normalizedIndex];

        prevSelectedSuggestion?.removeClass('is-selected');
        selectedSuggestion?.addClass('is-selected');

        this.selectedItem = normalizedIndex;

        if (scrollIntoView) {
            selectedSuggestion.scrollIntoView(false);
        }
    }
    wrapAround = (value: number, size: number): number => {
        return ((value % size) + size) % size;
    };
}

export abstract class TextInputSuggest<T> implements ISuggestOwner<T> {
    protected app: App;
    protected inputEl: HTMLInputElement;

    private popper: PopperInstance;
    private scope: Scope;
    private suggestEl: HTMLElement;
    private suggest: Suggest<T>;

    constructor(app: App, inputEl: HTMLInputElement) {
        this.app = app;
        this.inputEl = inputEl;
        this.scope = new Scope();

        this.suggestEl = createDiv('suggestion-container');
        const suggestion = this.suggestEl.createDiv('suggestion');
        this.suggest = new Suggest(this, suggestion, this.scope);

        this.scope.register([], 'Escape', this.close.bind(this));

        this.inputEl.addEventListener('input', this.onInputChanged.bind(this));
        this.inputEl.addEventListener('focus', this.onInputChanged.bind(this));
        this.inputEl.addEventListener('blur', this.close.bind(this));
        this.suggestEl.on(
            'mousedown',
            '.suggestion-container',
            (event: MouseEvent) => {
                event.preventDefault();
            }
        );
    }

    onInputChanged(): void {
        const inputStr = this.inputEl.value;
        const suggestions = this.getSuggestions(inputStr);

        if (suggestions.length > 0) {
            this.suggest.setSuggestions(suggestions);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.open((<any>this.app).dom.appContainerEl, this.inputEl);
        }
    }

    open(container: HTMLElement, inputEl: HTMLElement): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (<any>this.app).keymap.pushScope(this.scope);

        container.appendChild(this.suggestEl);
        this.popper = createPopper(inputEl, this.suggestEl, {
            placement: 'bottom-start',
            modifiers: [
                {
                    name: 'sameWidth',
                    enabled: true,
                    fn: ({ state, instance }) => {
                        // Note: positioning needs to be calculated twice -
                        // first pass - positioning it according to the width of the popper
                        // second pass - position it with the width bound to the reference element
                        // we need to early exit to avoid an infinite loop
                        const targetWidth = `${state.rects.reference.width}px`;
                        if (state.styles.popper.width === targetWidth) {
                            return;
                        }
                        state.styles.popper.width = targetWidth;
                        instance.update();
                    },
                    phase: 'beforeWrite',
                    requires: ['computeStyles'],
                },
            ],
        });
    }

    close(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (<any>this.app).keymap.popScope(this.scope);

        this.suggest.setSuggestions([]);
        this.popper.destroy();
        this.suggestEl.detach();
    }

    abstract getSuggestions(inputStr: string): T[];
    abstract renderSuggestion(item: T, el: HTMLElement): void;
    abstract selectSuggestion(item: T): void;
}

export class TextSuggest extends TextInputSuggest<string> {
    suggestions: string[];

    constructor(app: App, inputEl: HTMLInputElement, suggestions: string[]) {
        super(app, inputEl);

        this.suggestions = suggestions;
    }

    getSuggestions(inputStr: string): string[] {
        return this.suggestions.filter((suggestion) =>
            suggestion.includes(inputStr)
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string): void {
        this.inputEl.value = value;
        this.inputEl.trigger('input');
        this.close();
    }
}

export class FileSuggest extends TextInputSuggest<TFile> {
    getSuggestions(inputStr: string): TFile[] {
        const abstractFiles = this.app.vault.getMarkdownFiles();
        const files: TFile[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((file: TAbstractFile) => {
            if (
                file instanceof TFile &&
                file.path.toLowerCase().contains(lowerCaseInputStr)
            ) {
                files.push(file);
            }
        });

        return files;
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger('input');
        this.close();
    }
}

export class FolderSuggest extends TextInputSuggest<TFolder> {
    getSuggestions(inputStr: string): TFolder[] {
        const abstractFiles = this.app.vault.getAllLoadedFiles();
        const folders: TFolder[] = [];
        const lowerCaseInputStr = inputStr.toLowerCase();

        abstractFiles.forEach((folder: TAbstractFile) => {
            if (
                folder instanceof TFolder &&
                folder.path.toLowerCase().contains(lowerCaseInputStr)
            ) {
                folders.push(folder);
            }
        });

        return folders;
    }

    renderSuggestion(file: TFolder, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFolder): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger('input');
        this.close();
    }
}
