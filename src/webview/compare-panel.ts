// src/webview/compare-panel.ts

import * as fs from "fs";
import * as vscode from "vscode";
import { ExtractorBuilder } from "../core/extractors/builder";
import { CompareOptions, DatabaseMetadata, ICacheManager, IComparator, ICompareResult, IConnectionConfig, IMetadataDiff, IProcedureDiff, IProcedureInfo, ITableDiff, ITableInfo } from "../core/types";
import { CacheManager } from "./CacheManager";
import { Comparator } from "./Comparator";
import { ConfigBuilder } from "./ConfigBuilder";
import { Logger } from "./Logger";
import { MetadataAdapter } from "./MetadataAdapter";

const CONFIG_KEYS = {
    lastSource: "db-compare.lastSource",
    lastTarget: "db-compare.lastTarget",
};

export class ComparePanel {
    private static currentPanel: ComparePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private logger = Logger.getInstance();
    private cacheManager: ICacheManager;
    private comparator: IComparator;

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        if (ComparePanel.currentPanel) {
            ComparePanel.currentPanel._panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel("dbCompare", "DB Schema Compare", vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "webview"), vscode.Uri.joinPath(extensionUri, "webview/scripts")],
        });
        ComparePanel.currentPanel = new ComparePanel(panel, extensionUri, context);
    }

    private async webViewMessageHandler(message: any) {
        this.logger.log(MESSAGES.DID_RECEIVE_MESSAGE(message.command));

        switch (message.command) {
            case COMMANDS.COMPARE:
                await this.runComparison(message.config, message.useCache);
                break;
            case COMMANDS.SAVE_CACHE:
                this.cacheManager.saveCache(message.hash, message.data);
                break;
            case COMMANDS.GET_CACHE_LIST:
                const list = this.cacheManager.getCacheList();
                this.sendMessage({ command: COMMANDS.CACHE_LIST, list });
                break;
            case COMMANDS.DELETE_CACHE:
                await this.deleteCacheWithConfirm(message.hash);
                break;
            case COMMANDS.SHOW_LOGS:
                await vscode.commands.executeCommand("workbench.action.output.toggleOutput");
                this.logger.show();
                break;
            case COMMANDS.EXPORT_CACHE:
                await this.exportCacheFile(message.hash);
                break;
            case "openObject":
                await this.openIDE(message);
                break;
        }
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext,
    ) {
        this._panel = panel;
        this._panel.webview.html = this._getWebviewContent();
        this.cacheManager = new CacheManager(context);
        this.comparator = new Comparator();

        this._panel.webview.onDidReceiveMessage((msg) => this.webViewMessageHandler(msg), null, this._disposables);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async deleteCacheWithConfirm(hash: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(MESSAGES.DELETE_CACHE_CONFIRM, { modal: true }, MESSAGES.DELETE_CACHE_CONFIRM_YES, MESSAGES.DELETE_CACHE_CONFIRM_NO);
        if (confirm === MESSAGES.DELETE_CACHE_CONFIRM_YES) {
            this.cacheManager.deleteCacheFile(hash);
            this.sendMessage({ command: COMMANDS.CACHE_DELETED });
            vscode.window.showInformationMessage(MESSAGES.CACHE_DELETED_SUCCESS);
        }
    }

    private async exportCacheFile(hash: string): Promise<void> {
        const cachePath = this.cacheManager.getCachePath(hash);
        if (!fs.existsSync(cachePath)) {
            vscode.window.showErrorMessage(MESSAGES.CACHE_FILE_NOT_FOUND);
            return;
        }

        const uri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: MESSAGES.EXPORT_SELECT_FOLDER,
        });

        if (!uri || uri.length === 0) return;

        try {
            const targetPath = this.cacheManager.exportCache(uri[0].fsPath, hash);
            if (targetPath) {
                this.sendMessage({ command: COMMANDS.CACHE_EXPORTED });
                vscode.window.showInformationMessage(MESSAGES.EXPORT_SUCCESS(targetPath));
            } else {
                vscode.window.showErrorMessage(MESSAGES.EXPORT_FAILED);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(MESSAGES.EXPORT_ERROR(msg));
        }
    }

    private async openIDE(message: any) {
        await this.openMetadataObject("");
    }

    private sendResult(source: any, target: any, diff: any, viewMode: string, config: IConnectionConfig) {
        this.sendMessage({
            command: COMMANDS.RESULT,
            source,
            target,
            diff,
            viewMode,
            normalizeSchemaEnabled: config.options.normalizeSchemaEnabled,
            hideIdentical: config.options.hideIdentical ?? DEFAULT_VALUES.HIDE_IDENTICAL,
            ignoreCase: config.options.ignoreCase ?? DEFAULT_VALUES.IGNORE_CASE,
            config: {
                source: config.source.connectionString,
                target: config.target.connectionString,
            },
        });
    }

    private async saveLastConfig(config: IConnectionConfig) {
        this.logger.log(MESSAGES.SAVE_LAST_CONFIG);
        await vscode.workspace.getConfiguration().update(CONFIG_KEYS.lastSource, config.source.connectionString, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration().update(CONFIG_KEYS.lastTarget, config.target.connectionString, vscode.ConfigurationTarget.Global);
    }

    private sendLoading(message: string) {
        this.logger.log(message);
        this.sendMessage({ command: COMMANDS.LOADING, status: true, message });
    }

    private sendError(message: string) {
        this.logger.error(message);
        this.sendMessage({ command: COMMANDS.ERROR, message });
        vscode.window.showErrorMessage(MESSAGES.COMPARE_ERROR(message));
    }

    private async runComparison(rawConfig: any, rawUseCache: any) {
        const useCache = rawUseCache ?? false;
        const config = ConfigBuilder.build(rawConfig);
        const viewMode = rawConfig.viewMode || DEFAULT_VALUES.VIEW_MODE;

        this.logger.wipe();

        await this.saveLastConfig(config);

        const hash = this.cacheManager.computeHash(config.source.connectionString, config.target.connectionString);

        let sourceRaw: DatabaseMetadata | null = null;
        let targetRaw: DatabaseMetadata | null = null;

        if (useCache) {
            const cached = this.cacheManager.loadCache(hash);
            if (cached?.source && cached?.target) {
                sourceRaw = cached.source;
                targetRaw = cached.target;
            }
        }

        if (!sourceRaw || !targetRaw) {
            try {
                this.sendLoading(MESSAGES.CONNECTING_SOURCE);
                const sourceExtractor = ExtractorBuilder.createExtractor(config.source.connectionString);
                const targetExtractor = ExtractorBuilder.createExtractor(config.target.connectionString);
                if (!sourceExtractor || !targetExtractor) {
                    throw new Error(MESSAGES.UNKNOWN_DB_TYPE);
                }

                this.sendLoading(MESSAGES.EXTRACTING_SOURCE);
                sourceRaw = await sourceExtractor.extractMetadataAsync();

                this.sendLoading(MESSAGES.EXTRACTING_TARGET);
                targetRaw = await targetExtractor.extractMetadataAsync();

                // Сохраняем в кэш (без diff)
                this.cacheManager.saveCache(hash, { source: sourceRaw, target: targetRaw });
            } catch (err: any) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.error(msg);
                this.sendError(msg);
                return;
            }
        }

        try {
            const sourceMeta = MetadataAdapter.adapt(sourceRaw, config);
            const targetMeta = MetadataAdapter.adapt(targetRaw, config);
            const compareOptions = new CompareOptions(config.options.ignoreCase ?? DEFAULT_VALUES.IGNORE_CASE, config.options.hideIdentical ?? DEFAULT_VALUES.HIDE_IDENTICAL);
            const diff = this.comparator.compareMetadata(sourceMeta, targetMeta, compareOptions);
            this.sendResult(sourceMeta, targetMeta, diff, viewMode, config);
        } catch (err: any) {
            this.sendError(err.message || MESSAGES.UNKNOWN_ERROR);
        }
    }

    // ---------- Webview ----------
    private _getWebviewContent(): string {
        const webviewFolder = vscode.Uri.joinPath(this.extensionUri, "webview");
        const htmlPath = vscode.Uri.joinPath(webviewFolder, "index.html");
        const rawHtml = fs.readFileSync(htmlPath.fsPath, "utf8");

        // 1. Получаем переводы (основные + фоллбек)
        const fallbackTranslations = this._loadFallbackTranslations();
        const finalTranslations = this._buildFinalTranslations(fallbackTranslations);

        // 2. Обрабатываем HTML (локализация статики + замена путей и переменных)
        let processedHtml = this._localizeStaticHtml(rawHtml, fallbackTranslations);
        processedHtml = this._injectI18nScript(processedHtml, finalTranslations);
        processedHtml = this._injectConfigVariables(processedHtml);
        processedHtml = this._injectWebviewResourceUris(processedHtml, webviewFolder);

        return processedHtml;
    }

    /**
     * Загружает базовый (английский) файл локализации для фоллбека.
     */
    private _loadFallbackTranslations(): Record<string, string> {
        const fallbackPath = vscode.Uri.joinPath(this.extensionUri, "locales", "bundle.l10n.json");
        try {
            if (fs.existsSync(fallbackPath.fsPath)) {
                return JSON.parse(fs.readFileSync(fallbackPath.fsPath, "utf8"));
            }
        } catch (e) {
            console.error("Failed to load fallback translations:", e);
        }
        return {};
    }

    /**
     * Формирует финальный объект переводов для передачи в скрипты Webview.
     */
    private _buildFinalTranslations(fallback: Record<string, string>): Record<string, string> {
        const finalTranslations: Record<string, string> = {};
        for (const key of Object.keys(fallback)) {
            const translated = vscode.l10n.t(key);
            finalTranslations[key] = translated === key ? fallback[key] : translated;
        }
        return finalTranslations;
    }

    /**
     * Заменяет конструкции $t('key') в статическом HTML-файле.
     */
    private _localizeStaticHtml(html: string, fallback: Record<string, string>): string {
        return html.replace(/\$t\(['"]([^'"]+)['"]\)/g, (_, key) => {
            const translated = vscode.l10n.t(key);
            return translated === key && fallback[key] ? fallback[key] : translated;
        });
    }

    /**
     * Внедряет глобальный JS-объект локализации в тег <head> для динамических скриптов.
     */
    private _injectI18nScript(html: string, translations: Record<string, string>): string {
        const i18nScript = `
    <script>
        window.i18n = {
            _translations: ${JSON.stringify(translations)},
            t: function(key) { return this._translations[key] || key; }
        };
    </script>`;
        return html.replace("<head>", `<head>${i18nScript}`);
    }

    /**
     * Подставляет значения из конфигурации VS Code (Source/Target).
     */
    private _injectConfigVariables(html: string): string {
        const config = vscode.workspace.getConfiguration();
        const lastSource = config.get<string>(CONFIG_KEYS.lastSource) || "";
        const lastTarget = config.get<string>(CONFIG_KEYS.lastTarget) || "";

        return html.replace(/\{\{lastSource\}\}/g, lastSource).replace(/\{\{lastTarget\}\}/g, lastTarget);
    }

    /**
     * Переводит относительные пути ресурсов (CSS, JS) в специальные Webview URI.
     */
    private _injectWebviewResourceUris(html: string, webviewFolder: vscode.Uri): string {
        const styleUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, "style.css"));
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, "dist/bundle.js"));

        return html.replace('href="style.css"', `href="${styleUri}"`).replace('src="dist/bundle.js"', `src="${scriptUri}"`);
    }

    private sendMessage(message: any) {
        this._panel.webview.postMessage(message);
    }

    public dispose() {
        ComparePanel.currentPanel = undefined;
        this._disposables.forEach((d) => d.dispose());
    }

    async openMetadataObject(objectName: string) {
        // 1. Создаем виртуальный документ с языком SQL
        const document = await vscode.workspace.openTextDocument({
            language: "sql",
            content: `\n\n-- Нажмите F12 или скрипт сработает автоматически\n${objectName}\n\n`,
        });

        // 2. Открываем его в активном редакторе
        const editor = await vscode.window.showTextDocument(document);

        // 3. Ставим курсор ровно на имя нашего метаобъекта (ищем его координаты)
        const text = document.getText();
        const index = text.indexOf(objectName);
        const startPos = document.positionAt(index);
        const endPos = document.positionAt(index + objectName.length);

        editor.selection = new vscode.Selection(startPos, endPos);

        // 4. Твоя UI-подсказка: для mssql нужно, чтобы у окна было активно подключение.
        // Ты можешь вызвать команду подключения mssql, чтобы пользователю вывалился список профилей:
        // await vscode.commands.executeCommand('mssql.connect');

        // 5. Вызываем стандартную команду VS Code "Перейти к определению"
        // Если расширение mssql/postgres активно и подключено к этой БД, оно само откроет структуру объекта!
        await vscode.commands.executeCommand("editor.action.goToDeclaration");
    }
}

export const COMMANDS = {
    COMPARE: "compare",
    SAVE_CACHE: "saveCache",
    GET_CACHE_LIST: "getCacheList",
    DELETE_CACHE: "deleteCache",
    EXPORT_CACHE: "exportCache",
    CACHE_LIST: "cacheList",
    CACHE_DELETED: "cacheDeleted",
    CACHE_EXPORTED: "cacheExported",
    SHOW_LOGS: "showLogsOutputChannel",
    LOADING: "loading",
    ERROR: "error",
    RESULT: "result",
} as const;

export const MESSAGES = {
    DELETE_CACHE_CONFIRM: "Удалить этот кэш?",
    DELETE_CACHE_CONFIRM_YES: "Удалить",
    DELETE_CACHE_CONFIRM_NO: "Отмена",
    CACHE_DELETED_SUCCESS: "Кэш удалён",
    CACHE_FILE_NOT_FOUND: "Файл кэша не найден",
    EXPORT_SELECT_FOLDER: "Выберите папку для экспорта кэша",
    EXPORT_SUCCESS: (path: string) => `Кэш экспортирован в ${path}`,
    EXPORT_FAILED: "Кэш не экспортирован",
    EXPORT_ERROR: (error: string) => `Ошибка экспорта: ${error}`,
    CONNECTING_SOURCE: "Подключение к бд-источнику...",
    EXTRACTING_SOURCE: "Извлечение метаданных из источника...",
    EXTRACTING_TARGET: "Извлечение метаданных из приёмника...",
    UNKNOWN_DB_TYPE: "Не удалось определить тип одной из баз данных",
    UNKNOWN_ERROR: "Неизвестная ошибка",
    COMPARE_ERROR: (msg: string) => `DB Compare: ${msg}`,
    CACHE_SAVED: (hash: string, path: string) => `Cache saved for ${hash}; path: ${path}`,
    CACHE_LOAD_FAILED_NO_FILE: (hash: string) => `Load cache failed: ${hash}; file not exists`,
    CACHE_LOADED: (hash: string, path: string) => `Load cache for ${hash}; path: ${path}`,
    CACHE_LOAD_ERROR: (hash: string, error: string) => `Failed to load cache ${hash}: ${error}`,
    CACHE_DELETED: (path: string) => `Cache deleted: ${path}`,
    CACHE_DELETE_ERROR: (path: string, error: string) => `Failed to delete cache: ${path}; ${error}`,
    CACHE_READ_ERROR: (file: string, error: string) => `Failed to read cache file ${file}: ${error}`,
    DID_RECEIVE_MESSAGE: (cmd: string) => `didreceivemessage: ${cmd}`,
    SAVE_LAST_CONFIG: "save last config",
} as const;

export const DEFAULT_VALUES = {
    IGNORE_CASE: true,
    NORMALIZE_TYPES: true,
    NORMALIZE_SCHEMA_ENABLED: true,
    HIDE_IDENTICAL: false,
    VIEW_MODE: "detailed",
} as const;

export class MetadataDiffResult implements IMetadataDiff {
    constructor(
        public tables: ICompareResult<ITableInfo, ITableDiff>,
        public procedures: ICompareResult<IProcedureInfo, IProcedureDiff>,
    ) {}
}
