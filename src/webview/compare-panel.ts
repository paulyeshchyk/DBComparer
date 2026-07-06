// src/webview/compare-panel.ts

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ExtractorBuilder } from "../core/extractors/builder";
import { MetadataBuilder } from "../core/metadata-builder";
import { CompareOptions, DatabaseMetadata, ICacheManager, IColumnDiff, IColumnInfo, IComparator, ICompareResult, IConnectionConfig, IIndexDiff, IIndexInfo, IMetadataDiff, IParameterDiff, IParameterInfo, IProcedureDiff, IProcedureInfo, ITableDiff, ITableInfo } from "../core/types";

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
        const htmlContent = fs.readFileSync(htmlPath.fsPath, "utf8");

        const config = vscode.workspace.getConfiguration();
        const lastSource = config.get<string>(CONFIG_KEYS.lastSource) || "";
        const lastTarget = config.get<string>(CONFIG_KEYS.lastTarget) || "";

        let processedHtml = htmlContent.replace(/\{\{lastSource\}\}/g, lastSource).replace(/\{\{lastTarget\}\}/g, lastTarget);

        const styleUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, "style.css"));
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, "dist/bundle.js"));

        processedHtml = processedHtml.replace('href="style.css"', `href="${styleUri}"`);
        processedHtml = processedHtml.replace('src="dist/bundle.js"', `src="${scriptUri}"`);

        return processedHtml;
    }

    private sendMessage(message: any) {
        this._panel.webview.postMessage(message);
    }

    public dispose() {
        ComparePanel.currentPanel = undefined;
        this._disposables.forEach((d) => d.dispose());
    }
}

export class Comparator implements IComparator {
    private tableComparator = new TableComparator();
    private procComparator = new ProcedureComparator();
    private logger = Logger.getInstance();

    compareMetadata(source: DatabaseMetadata, target: DatabaseMetadata, options: CompareOptions): IMetadataDiff {
        this.logger.log(`Compare - ignore case:${options.ignoreCase}; hideIdentical:${options.hideIdentical}; source:${source.connectionString}; target:${target.connectionString}`);

        const tablesResult = this.tableComparator.compareTables(source.tables, target.tables, options);
        const procsResult = this.procComparator.compareProcedures(source.procedures, target.procedures, options);

        return new MetadataDiffResult(tablesResult, procsResult);
    }
}

export class MetadataAdapter {
    public static adapt(sourceRaw: DatabaseMetadata, config: IConnectionConfig) {
        const sourceMeta = JSON.parse(JSON.stringify(sourceRaw));

        if (config.options.normalizeTypes) {
            MetadataBuilder.normalizeTypes(sourceMeta);
        }
        if (config.options.normalizeSchemaEnabled) {
            MetadataBuilder.normalizeSchema(config, sourceMeta);
        }
        // Применяем фильтры (используя уже нормализованные схемы)
        const include = config.options.includeFilters ?? ["*"];
        const exclude = config.options.excludeFilters ?? [];
        const filtered = MetadataBuilder.applyFilters(sourceMeta, include, exclude);
        // Сортируем после фильтрации
        MetadataBuilder.resort(filtered);
        return filtered;
    }
}
interface ProgressFormatResult {
    formattedCurrent: string; // Строка с ведущими нулями, например '001'
    formattedTotal: string; // Общее количество в виде строки, например '202'
    formattedStr: string; // Готовая строка вида '[001/202]'
}

export class Logger {
    private static instance: Logger;
    private channel: vscode.OutputChannel;
    private static outputChannelName: string = "DB Compare";

    public formatProgress(index: number, array: any[]): ProgressFormatResult {
        const totalCount = array.length;
        const currentStep = index + 1; // Переводим индекс 0-based в человеческий счет от 1

        // Вычисляем максимальную длину самого большого числа
        const maxLength = totalCount.toString().length;

        // Добавляем ведущие нули
        const formattedCurrent = currentStep.toString().padStart(maxLength, "0");
        const formattedTotal = totalCount.toString();
        const formattedStr = `[${formattedCurrent}/${formattedTotal}]`;

        return {
            formattedCurrent,
            formattedTotal,
            formattedStr,
        };
    }

    // Хранилище для постоянной истории логов
    private history: string[] = [];
    // Переменная для одной динамической строки (например, прогресса)
    private currentStatus: string | null = null;

    private constructor() {
        this.channel = vscode.window.createOutputChannel(Logger.outputChannelName);
    }

    static getOutputChannelName(): string {
        return Logger.outputChannelName;
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Обычный лог.
     * @param isStatus Если true, строка перезапишет предыдущий статус вместо добавления в историю.
     */
    log(message: string, isStatus: boolean = false) {
        let dateTime = new Date();
        const formattedMessage = `${dateTime.toLocaleString()} [Info]: ${message}`;

        if (isStatus) {
            this.currentStatus = formattedMessage;
            this.refresh();
        } else {
            this.history.push(formattedMessage);
            this.refresh();
        }
    }

    error(message: string) {
        let dateTime = new Date();
        const formattedMessage = `${dateTime.toLocaleString()} [Err ]: ${message}`;

        this.history.push(formattedMessage);
        this.refresh();
    }

    /**
     * Специальный метод для фиксации/завершения статуса.
     * Превращает текущую строку статуса в обычный постоянный лог.
     */
    commitStatus() {
        if (this.currentStatus) {
            this.history.push(this.currentStatus);
            this.currentStatus = null;
            this.refresh();
        }
    }

    /**
     * Сбросить текущую временную строку без сохранения в историю
     */
    clearStatus() {
        this.currentStatus = null;
        this.refresh();
    }

    wipe() {
        this.history = [];
        this.channel.clear();
    }

    show() {
        this.channel.show();
    }

    private lastRefreshTime = 0;
    private refreshTimeout: NodeJS.Timeout | null = null;

    private refresh() {
        const now = Date.now();

        // Если с прошлого обновления прошло меньше 150 мс, откладываем отрисовку
        if (now - this.lastRefreshTime < 150) {
            if (this.refreshTimeout) clearTimeout(this.refreshTimeout);

            this.refreshTimeout = setTimeout(() => this.doActualRefresh(), 150);
            return;
        }

        if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
        this.doActualRefresh();
    }

    // Тот самый метод, который раньше был просто refresh
    private doActualRefresh() {
        this.lastRefreshTime = Date.now();
        this.channel.clear();

        for (const line of this.history) {
            this.channel.appendLine(line);
        }
        if (this.currentStatus) {
            this.channel.appendLine(this.currentStatus);
        }
    }
}

export class ConfigBuilder {
    static build(rawConfig: any): IConnectionConfig {
        const sourceConn = rawConfig.source;
        const targetConn = rawConfig.target;
        const ignoreCase = rawConfig.ignoreCase ?? true;
        const normalizeTypes = rawConfig.normalizeTypes ?? true;
        const normalizeSchemaEnabled = rawConfig.normalizeSchemaEnabled ?? true;
        const normalizeSchema = rawConfig.normalizeSchema;
        const hideIdentical = rawConfig.hideIdentical ?? false;

        return {
            source: { connectionString: sourceConn },
            target: { connectionString: targetConn },
            options: {
                normalizeTypes,
                normalizeSchemaEnabled,
                normalizeSchema: normalizeSchema && Object.keys(normalizeSchema).length > 0 ? normalizeSchema : undefined,
                ignoreCase,
                hideIdentical,
                includeFilters: rawConfig.includeFilters || ["*"], // <--
                excludeFilters: rawConfig.excludeFilters || [], // <--
            },
        };
    }
}

export class CacheManager implements ICacheManager {
    private logger = Logger.getInstance();

    constructor(private readonly context: vscode.ExtensionContext) {}

    getCacheDir(): string {
        const cacheDir = path.join(this.context.globalStorageUri.fsPath, "cache");
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        return cacheDir;
    }

    getCachePath(hash: string): string {
        return path.join(this.getCacheDir(), `${hash}.json`);
    }

    computeHash(sourceConn: string, targetConn: string): string {
        const data = sourceConn + "||" + targetConn;
        return crypto.createHash("sha256").update(data).digest("hex");
    }

    saveCache(hash: string, data: any): void {
        const cachePath = this.getCachePath(hash);
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
        this.logger.log(`Cache saved for ${hash}; path: ${cachePath}`);
    }

    loadCache(hash: string): any | null {
        const cachePath = this.getCachePath(hash);
        if (!fs.existsSync(cachePath)) {
            this.logger.log(`Load cache failed: ${hash}; file not exists`);
            return null;
        }
        try {
            this.logger.log(`Load cache for ${hash}; path: ${cachePath}`);

            const content = fs.readFileSync(cachePath, "utf8");
            return JSON.parse(content);
        } catch (err) {
            this.logger.error(`Failed to load cache ${hash}: ${err}`);
            fs.unlinkSync(cachePath);
            return null;
        }
    }

    deleteCacheFile(hash: string): void {
        const cachePath = this.getCachePath(hash);
        if (fs.existsSync(cachePath)) {
            try {
                fs.unlinkSync(cachePath);
                this.logger.log(`Cache deleted: ${cachePath}`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.logger.error(`Failed to delete cache: ${cachePath}; ${msg}`);

                throw e;
            }
        }
    }

    getCacheList(): any[] {
        const cacheDir = this.getCacheDir();
        const files = fs.readdirSync(cacheDir);
        const list: any[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const fullPath = path.join(cacheDir, file);
            try {
                const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
                const hash = path.basename(file, ".json");
                const { sourceName, targetName } = this.extractNames(data);
                list.push({
                    hash,
                    sourceName,
                    targetName,
                    timestamp: data.timestamp || 0,
                });
            } catch (err) {
                this.logger.error(`Failed to read cache file ${file}: ${err}`);
            }
        }
        list.sort((a, b) => b.timestamp - a.timestamp);
        return list;
    }

    exportCache(targetDir: string, hash: string): string | null {
        const cachePath = this.getCachePath(hash);
        if (!fs.existsSync(cachePath)) {
            return null;
        }

        // Создаём папку, если её нет
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const fileName = `cache_${hash}.json`;
        const targetPath = path.join(targetDir, fileName);

        fs.copyFileSync(cachePath, targetPath);
        return targetPath;
    }

    private extractNames(data: any): { sourceName: string; targetName: string } {
        let sourceName = "—";
        let targetName = "—";
        if (data.config) {
            sourceName = data.config.source || "—";
            targetName = data.config.target || "—";
        } else if (data.source && data.target) {
            sourceName = data.source.connectionString || "—";
            targetName = data.target.connectionString || "—";
        }
        return { sourceName, targetName };
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

export class TableComparator {
    private columnComparator = new ColumnComparator();
    private indexComparator = new IndexComparator();

    compareTables(srcTables: ITableInfo[], tgtTables: ITableInfo[], options: CompareOptions): ICompareResult<ITableInfo, ITableDiff> {
        const normalizeName = (schema: string, name: string) => MetadataBuilder.normalizeName(schema, name, options.ignoreCase);

        const allTables = new Map<string, { source: ITableInfo | null; target: ITableInfo | null }>();
        srcTables.forEach((t) => {
            const key = normalizeName(t.schema, t.name);
            if (!allTables.has(key)) allTables.set(key, { source: null, target: null });
            allTables.get(key)!.source = t;
        });
        tgtTables.forEach((t) => {
            const key = normalizeName(t.schema, t.name);
            if (!allTables.has(key)) allTables.set(key, { source: null, target: null });
            allTables.get(key)!.target = t;
        });

        const onlyInSource: ITableInfo[] = [];
        const onlyInTarget: ITableInfo[] = [];
        const common: ITableDiff[] = [];
        const caseDifferences: { schema: string; name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of allTables) {
            if (pair.source && !pair.target) {
                onlyInSource.push(pair.source);
            } else if (!pair.source && pair.target) {
                onlyInTarget.push(pair.target);
            } else if (pair.source && pair.target) {
                const result = this.pushCommon(pair.source, pair.target, options);
                if (result) {
                    common.push(result);
                }
            }
        }

        return { onlyInSource, onlyInTarget, common, caseDifferences };
    }

    private pushCommon(src: ITableInfo, tgt: ITableInfo, options: CompareOptions): ITableDiff | null {
        const srcFull = `${src.schema}.${src.name}`;
        const tgtFull = `${tgt.schema}.${tgt.name}`;

        // Регистровые различия добавляем в caseDifferences (но они не влияют на hasRealDiff)
        // Они будут добавлены в общий результат, но мы не можем добавить их здесь,
        // так как caseDifferences собирается отдельно. Поэтому мы просто проверяем наличие
        // и если ignoreCase выключен, то добавляем в массив caseDifferences (это делается в основном цикле).
        // Поэтому здесь просто выполняем сравнение деталей.

        const colDetails = this.columnComparator.compare(src.columns, tgt.columns, options.ignoreCase);
        const indexDetails = this.indexComparator.compare(src.indexes, tgt.indexes, options.ignoreCase);
        const hasRealDiff = this.hasRealDifferences(colDetails, indexDetails, options.ignoreCase);

        if (options.hideIdentical && !hasRealDiff) {
            return null;
        }

        return {
            schema: src.schema,
            name: src.name,
            columns: colDetails,
            indexes: indexDetails,
        };
    }

    private hasRealDifferences(colDetails: IColumnDiff, indexDetails: IIndexDiff, ignoreCase: boolean): boolean {
        const hasColDiff = colDetails.onlyInSource.length > 0 || colDetails.onlyInTarget.length > 0 || colDetails.diff.length > 0;
        const hasIdxDiff = indexDetails.onlyInSource.length > 0 || indexDetails.onlyInTarget.length > 0 || indexDetails.diff.length > 0;
        const hasCaseDiff = colDetails.caseDiff.length > 0 || indexDetails.caseDiff.length > 0;
        return hasColDiff || hasIdxDiff || (hasCaseDiff && !ignoreCase);
    }
}

export class ParameterComparator {
    compare(srcParams: IParameterInfo[], tgtParams: IParameterInfo[], ignoreCase: boolean): IParameterDiff {
        const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
        const all = new Map<string, { source: IParameterInfo | null; target: IParameterInfo | null }>();
        srcParams.forEach((p) => {
            const key = normalize(p.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.source = p;
        });
        tgtParams.forEach((p) => {
            const key = normalize(p.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.target = p;
        });

        const onlyInSource: string[] = [];
        const onlyInTarget: string[] = [];
        const diff: { name: string; sourceType: string; targetType: string }[] = [];
        const caseDiff: { name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of all) {
            const src = pair.source;
            const tgt = pair.target;
            if (src && !tgt) {
                onlyInSource.push(src.name);
            } else if (!src && tgt) {
                onlyInTarget.push(tgt.name);
            } else if (src && tgt) {
                const srcName = src.name;
                const tgtName = tgt.name;
                if (!ignoreCase && srcName !== tgtName) {
                    caseDiff.push({ name: srcName, sourceName: srcName, targetName: tgtName });
                }
                const srcDesc = this.formatParamDesc(src);
                const tgtDesc = this.formatParamDesc(tgt);
                if (srcDesc !== tgtDesc) {
                    diff.push({ name: srcName, sourceType: srcDesc, targetType: tgtDesc });
                }
            }
        }

        return { onlyInSource, onlyInTarget, diff, caseDiff };
    }

    private formatParamDesc(p: IParameterInfo): string {
        let desc = p.dataType || "";
        if (!p.isNullable) desc += " NOT NULL";
        else desc += " NULL";
        if (p.isOutput) desc += " OUTPUT";
        if (p.maxLength && p.maxLength > 0) desc += `(${p.maxLength})`;
        else if (p.precision && p.scale !== undefined) desc += `(${p.precision},${p.scale})`;
        return desc;
    }
}

export class ProcedureComparator {
    private paramComparator = new ParameterComparator();

    compareProcedures(srcProcs: IProcedureInfo[], tgtProcs: IProcedureInfo[], options: CompareOptions): ICompareResult<IProcedureInfo, IProcedureDiff> {
        const normalizeName = (schema: string, name: string) => MetadataBuilder.normalizeName(schema, name, options.ignoreCase);

        const allProcs = new Map<string, { source: IProcedureInfo | null; target: IProcedureInfo | null }>();
        srcProcs.forEach((p) => {
            const key = normalizeName(p.schema, p.name);
            if (!allProcs.has(key)) allProcs.set(key, { source: null, target: null });
            allProcs.get(key)!.source = p;
        });
        tgtProcs.forEach((p) => {
            const key = normalizeName(p.schema, p.name);
            if (!allProcs.has(key)) allProcs.set(key, { source: null, target: null });
            allProcs.get(key)!.target = p;
        });

        const onlyInSource: IProcedureInfo[] = [];
        const onlyInTarget: IProcedureInfo[] = [];
        const common: IProcedureDiff[] = [];
        const caseDifferences: { schema: string; name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of allProcs) {
            if (pair.source && !pair.target) {
                onlyInSource.push(pair.source);
            } else if (!pair.source && pair.target) {
                onlyInTarget.push(pair.target);
            } else if (pair.source && pair.target) {
                const result = this.pushCommon(pair.source, pair.target, options);
                if (result) {
                    common.push(result);
                }
            }
        }

        return { onlyInSource, onlyInTarget, common, caseDifferences };
    }

    private pushCommon(src: IProcedureInfo, tgt: IProcedureInfo, options: CompareOptions): IProcedureDiff | null {
        const srcFull = `${src.schema}.${src.name}`;
        const tgtFull = `${tgt.schema}.${tgt.name}`;

        // Сравниваем параметры
        const paramDetails = this.paramComparator.compare(src.parameters || [], tgt.parameters || [], options.ignoreCase);

        // Проверяем наличие реальных различий (имя + параметры)
        const nameDiff = !options.ignoreCase && srcFull !== tgtFull;
        const hasParamDiff = paramDetails.onlyInSource.length > 0 || paramDetails.onlyInTarget.length > 0 || paramDetails.diff.length > 0 || (paramDetails.caseDiff.length > 0 && !options.ignoreCase);
        const hasRealDiff = nameDiff || hasParamDiff;

        if (options.hideIdentical && !hasRealDiff) {
            return null;
        }

        return {
            schema: src.schema,
            name: src.name,
            parameters: paramDetails,
        };
    }
}

export class ColumnComparator {
    compare(srcCols: IColumnInfo[], tgtCols: IColumnInfo[], ignoreCase: boolean): IColumnDiff {
        const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
        const all = new Map<string, { source: IColumnInfo | null; target: IColumnInfo | null }>();
        srcCols.forEach((c) => {
            const key = normalize(c.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.source = c;
        });
        tgtCols.forEach((c) => {
            const key = normalize(c.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.target = c;
        });

        const onlyInSource: string[] = [];
        const onlyInTarget: string[] = [];
        const diff: { name: string; sourceType: string; targetType: string }[] = [];
        const caseDiff: { name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of all) {
            const srcCol = pair.source;
            const tgtCol = pair.target;
            if (srcCol && !tgtCol) {
                onlyInSource.push(srcCol.name);
            } else if (!srcCol && tgtCol) {
                onlyInTarget.push(tgtCol.name);
            } else if (srcCol && tgtCol) {
                const srcName = srcCol.name;
                const tgtName = tgtCol.name;
                if (!ignoreCase && srcName !== tgtName) {
                    caseDiff.push({ name: srcName, sourceName: srcName, targetName: tgtName });
                }
                const srcDesc = this.formatColumnDesc(srcCol);
                const tgtDesc = this.formatColumnDesc(tgtCol);
                if (srcDesc !== tgtDesc) {
                    diff.push({ name: srcName, sourceType: srcDesc, targetType: tgtDesc });
                }
            }
        }

        return { onlyInSource, onlyInTarget, diff, caseDiff };
    }

    private formatColumnDesc(col: IColumnInfo): string {
        let desc = col.dataType || "";
        if (!col.isNullable) desc += " NOT NULL";
        else desc += " NULL";
        if (col.isPrimaryKey) desc += " PK";
        return desc;
    }
}

export class IndexComparator {
    compare(srcIndexes: IIndexInfo[], tgtIndexes: IIndexInfo[], ignoreCase: boolean): IIndexDiff {
        const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
        const all = new Map<string, { source: IIndexInfo | null; target: IIndexInfo | null }>();
        srcIndexes.forEach((idx) => {
            const key = normalize(idx.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.source = idx;
        });
        tgtIndexes.forEach((idx) => {
            const key = normalize(idx.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.target = idx;
        });

        const onlyInSource: string[] = [];
        const onlyInTarget: string[] = [];
        const diff: { name: string; sourceDesc: string; targetDesc: string }[] = [];
        const caseDiff: { name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of all) {
            const src = pair.source;
            const tgt = pair.target;
            if (src && !tgt) {
                onlyInSource.push(src.name);
            } else if (!src && tgt) {
                onlyInTarget.push(tgt.name);
            } else if (src && tgt) {
                const srcName = src.name;
                const tgtName = tgt.name;
                if (!ignoreCase && srcName !== tgtName) {
                    caseDiff.push({ name: srcName, sourceName: srcName, targetName: tgtName });
                }
                const srcDesc = this.formatIndexDesc(src);
                const tgtDesc = this.formatIndexDesc(tgt);
                if (srcDesc !== tgtDesc) {
                    diff.push({ name: srcName, sourceDesc: srcDesc, targetDesc: tgtDesc });
                }
            }
        }

        return { onlyInSource, onlyInTarget, diff, caseDiff };
    }

    private formatIndexDesc(idx: IIndexInfo): string {
        let desc = "";
        if (idx.isUnique) desc += "UNIQUE ";
        if (idx.isClustered) desc += "CLUSTERED ";
        if (idx.columns) desc += `(${idx.columns.join(", ")})`;
        return desc.trim();
    }
}
