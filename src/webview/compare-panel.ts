import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MetadataBuilder } from '../core/metadata-builder';
import { ExtractorBuilder } from '../core/extractors/builder';
import { ColumnInfo, ConnectionConfig, DatabaseMetadata, IndexInfo, ProcedureInfo, TableInfo } from '../core/types';

const CONFIG_KEYS = {
  lastSource: 'db-compare.lastSource',
  lastTarget: 'db-compare.lastTarget'
};

export class ComparePanel {
  public static currentPanel: ComparePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    if (ComparePanel.currentPanel) {
      ComparePanel.currentPanel._panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel('dbCompare', 'DB Schema Compare', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview')]
    });

    ComparePanel.currentPanel = new ComparePanel(panel, extensionUri, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._panel.webview.html = this._getWebviewContent();

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'compare':
            await this.runComparison(message.config);
            break;
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  // ---------- Кеширование ----------
  private getCacheDir(): string {
    const cacheDir = path.join(this.context.globalStoragePath, 'cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  }

  private getCachePath(hash: string): string {
    return path.join(this.getCacheDir(), `${hash}.json`);
  }

  private computeHash(sourceConn: string, targetConn: string): string {
    const data = sourceConn + '||' + targetConn;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private saveCache(hash: string, data: any): void {
    const cachePath = this.getCachePath(hash);
    fs.writeFileSync(cachePath, JSON.stringify(data), 'utf8');
  }

  private loadCache(hash: string): any | null {
    const cachePath = this.getCachePath(hash);
    if (fs.existsSync(cachePath)) {
      try {
        const content = fs.readFileSync(cachePath, 'utf8');
        return JSON.parse(content);
      } catch {
        // Если файл повреждён, удаляем и возвращаем null
        fs.unlinkSync(cachePath);
        return null;
      }
    }
    return null;
  }

  private deleteCache(hash: string): void {
    const cachePath = this.getCachePath(hash);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  }

  private formatColumnDesc(col: ColumnInfo): string {
    let desc = col.dataType || '';
    if (col.isNullable === false) desc += ' NOT NULL';
    else desc += ' NULL';
    if (col.isPrimaryKey) desc += ' PK';
    return desc;
  }
  // ---------- Основная логика ----------
  private async runComparison(rawConfig: any) {
    const sourceConn = rawConfig.source;
    const targetConn = rawConfig.target;
    const useCache = rawConfig.useCache ?? false;
    const ignoreCase = rawConfig.ignoreCase ?? true;
    const normalizeTypes = rawConfig.normalizeTypes ?? true;
    const normalizeSchemaEnabled = rawConfig.normalizeSchemaEnabled ?? true;
    const normalizeSchema = rawConfig.normalizeSchema; // объект из UI

    const config: ConnectionConfig = {
      source: { connectionString: sourceConn },
      target: { connectionString: targetConn },
      options: {
        normalizeTypes: normalizeTypes,
        normalizeSchemaEnabled: normalizeSchemaEnabled,
        normalizeSchema: normalizeSchema && Object.keys(normalizeSchema).length > 0 ? normalizeSchema : undefined,
        ignoreCase: ignoreCase
      }
    };

    // Сохраняем последние значения в настройки
    await vscode.workspace.getConfiguration().update(CONFIG_KEYS.lastSource, sourceConn, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration().update(CONFIG_KEYS.lastTarget, targetConn, vscode.ConfigurationTarget.Global);

    const hash = this.computeHash(sourceConn, targetConn);

    let sourceRaw: DatabaseMetadata | null = null;
    let targetRaw: DatabaseMetadata | null = null;

    // Проверка кеша
    if (useCache) {
      const cached = this.loadCache(hash);
      if (cached) {
        sourceRaw = cached.source;
        targetRaw = cached.target;
      }
    } else {
      this.deleteCache(hash);
    }

    // Если нет кеша – извлекаем из БД
    if (!sourceRaw || !targetRaw) {
      try {
        this.sendMessage({ command: 'loading', status: true, message: 'Подключение к бд-источнику...' });

        const sourceExtractor = ExtractorBuilder.createExtractor(sourceConn);
        const targetExtractor = ExtractorBuilder.createExtractor(targetConn);

        if (!sourceExtractor || !targetExtractor) {
          throw new Error('Не удалось определить тип одной из баз данных');
        }

        this.sendMessage({ command: 'loading', status: true, message: 'Извлечение метаданных из источника...' });
        sourceRaw = await sourceExtractor.extractMetadataAsync();

        this.sendMessage({ command: 'loading', status: true, message: 'Извлечение метаданных из приёмника...' });
        targetRaw = await targetExtractor.extractMetadataAsync();

        if (useCache) {
          this.saveCache(hash, { source: sourceRaw, target: targetRaw });
        }
      } catch (err: any) {
        this.sendMessage({
          command: 'error',
          message: err.message || 'Неизвестная ошибка'
        });
        vscode.window.showErrorMessage(`DB Compare: ${err.message}`);
        this.sendMessage({ command: 'loading', status: false });
        return;
      }
    }

    // Применяем нормализацию
    try {
      const sourceMeta = JSON.parse(JSON.stringify(sourceRaw));
        const targetMeta = JSON.parse(JSON.stringify(targetRaw));
        // Применяем нормализацию (если нужно)
        if (config.options.normalizeTypes) {
            MetadataBuilder.normalizeTypes(sourceMeta);
            MetadataBuilder.normalizeTypes(targetMeta);
        }
        if (config.options.normalizeSchemaEnabled) {
            MetadataBuilder.normalizeSchema(config, sourceMeta);
            MetadataBuilder.normalizeSchema(config, targetMeta);
        }
        MetadataBuilder.resort(sourceMeta);
        MetadataBuilder.resort(targetMeta);

        const diff = this.compareMetadata(sourceMeta, targetMeta, config.options.ignoreCase ?? false);

        this.sendMessage({
            command: 'result',
            source: sourceMeta,
            target: targetMeta,
            diff: diff,
            viewMode: rawConfig.viewMode || 'detailed',
            normalizeSchemaEnabled: config.options.normalizeSchemaEnabled
        });
    } catch (err: any) {
      this.sendMessage({
        command: 'error',
        message: err.message || 'Неизвестная ошибка'
      });
      vscode.window.showErrorMessage(`DB Compare: ${err.message}`);
    } finally {
      this.sendMessage({ command: 'loading', status: false });
    }
  }
  private formatIndexDesc(idx: IndexInfo): string {
    let desc = '';
    if (idx.isUnique) desc += 'UNIQUE ';
    if (idx.isClustered) desc += 'CLUSTERED ';
    if (idx.columns) desc += `(${idx.columns.join(', ')})`;
    return desc.trim();
  }
  // ---------- Сравнение метаданных с учётом регистра ----------
  private compareMetadata(source: DatabaseMetadata, target: DatabaseMetadata, ignoreCase: boolean) {
    const normalize = (schema: string, name: string) =>
      MetadataBuilder.normalizeName(schema, name, ignoreCase);

    // --- Таблицы ---
    const allTables = new Map<string, { source: TableInfo | null, target: TableInfo | null }>();
    (source.tables || []).forEach(t => {
      const key = normalize(t.schema, t.name);
      if (!allTables.has(key)) allTables.set(key, { source: null, target: null });
      allTables.get(key)!.source = t;
    });
    (target.tables || []).forEach(t => {
      const key = normalize(t.schema, t.name);
      if (!allTables.has(key)) allTables.set(key, { source: null, target: null });
      allTables.get(key)!.target = t;
    });

    const onlyInSource: TableInfo[] = [];
    const onlyInTarget: TableInfo[] = [];
    const commonTables: {
      schema: string,
      name: string,
      columns: {
        onlyInSource: string[],
        onlyInTarget: string[],
        diff: { name: string, sourceType: string, targetType: string }[],
        caseDiff: { name: string, sourceName: string, targetName: string }[]
      },
      indexes: {
        onlyInSource: string[];
        onlyInTarget: string[];
        diff: {
          name: string;
          sourceDesc: string;
          targetDesc: string;
        }[];
        caseDiff: {
          name: string;
          sourceName: string;
          targetName: string;
        }[];
      }
    }[] = [];
    const caseDifferences: { schema: string, name: string, sourceName: string, targetName: string }[] = [];

    for (let [key, pair] of allTables) {
      if (pair.source && !pair.target) {
        onlyInSource.push(pair.source);
      } else if (!pair.source && pair.target) {
        onlyInTarget.push(pair.target);
      } else {
        const src = pair.source!;
        const tgt = pair.target!;
        const srcFull = `${src.schema}.${src.name}`;
        const tgtFull = `${tgt.schema}.${tgt.name}`;
        if (srcFull !== tgtFull) {
          caseDifferences.push({
            schema: src.schema,
            name: src.name,
            sourceName: srcFull,
            targetName: tgtFull
          });
        }

        // Сравнение колонок
        const srcCols = src.columns || [];
        const tgtCols = tgt.columns || [];
        const allCols = new Map<string, { source: ColumnInfo | null, target: ColumnInfo | null }>();
        srcCols.forEach(c => {
          const keyCol = normalize(c.name, ''); // используем только имя, схема не нужна
          if (!allCols.has(keyCol)) allCols.set(keyCol, { source: null, target: null });
          allCols.get(keyCol)!.source = c;
        });
        tgtCols.forEach(c => {
          const keyCol = normalize(c.name, '');
          if (!allCols.has(keyCol)) allCols.set(keyCol, { source: null, target: null });
          allCols.get(keyCol)!.target = c;
        });

        const colDetails = {
          onlyInSource: [] as string[],
          onlyInTarget: [] as string[],
          diff: [] as { name: string, sourceType: string, targetType: string }[],
          caseDiff: [] as { name: string, sourceName: string, targetName: string }[]
        };

        for (let [colKey, colPair] of allCols) {
          const srcCol = colPair.source;
          const tgtCol = colPair.target;
          if (srcCol && !tgtCol) {
            colDetails.onlyInSource.push(srcCol.name);
          } else if (!srcCol && tgtCol) {
            colDetails.onlyInTarget.push(tgtCol.name);
          } else {
            // Есть в обеих
            const srcName = srcCol!.name;
            const tgtName = tgtCol!.name;
            if (srcName !== tgtName) {
              colDetails.caseDiff.push({
                name: srcName,
                sourceName: srcName,
                targetName: tgtName
              });
            }
            // Сравниваем типы, nullability, PK
            const srcType = srcCol!.dataType || '';
            const tgtType = tgtCol!.dataType || '';
            const srcNullable = srcCol!.isNullable;
            const tgtNullable = tgtCol!.isNullable;
            const srcPk = srcCol!.isPrimaryKey;
            const tgtPk = tgtCol!.isPrimaryKey;
            if (srcType !== tgtType || srcNullable !== tgtNullable || srcPk !== tgtPk) {
              const srcDesc = this.formatColumnDesc(srcCol!);
              const tgtDesc = this.formatColumnDesc(tgtCol!);
              colDetails.diff.push({
                name: srcName,
                sourceType: srcDesc,
                targetType: tgtDesc
              });
            }
          }
        }

        // ---- Сравнение индексов ----
        const srcIndexes = src.indexes || [];
        const tgtIndexes = tgt.indexes || [];
        const allIndexes = new Map<string, { source: IndexInfo | null, target: IndexInfo | null }>();
        srcIndexes.forEach(idx => {
          const keyIdx = ignoreCase ? idx.name.toLowerCase() : idx.name;
          if (!allIndexes.has(keyIdx)) allIndexes.set(keyIdx, { source: null, target: null });
          allIndexes.get(keyIdx)!.source = idx;
        });
        tgtIndexes.forEach(idx => {
          const keyIdx = ignoreCase ? idx.name.toLowerCase() : idx.name;
          if (!allIndexes.has(keyIdx)) allIndexes.set(keyIdx, { source: null, target: null });
          allIndexes.get(keyIdx)!.target = idx;
        });

        const indexDetails = {
          onlyInSource: [] as string[],
          onlyInTarget: [] as string[],
          diff: [] as { name: string, sourceDesc: string, targetDesc: string }[],
          caseDiff: [] as { name: string, sourceName: string, targetName: string }[]
        };

        for (let [idxKey, idxPair] of allIndexes) {
          const srcIdx = idxPair.source;
          const tgtIdx = idxPair.target;
          if (srcIdx && !tgtIdx) {
            indexDetails.onlyInSource.push(srcIdx.name);
          } else if (!srcIdx && tgtIdx) {
            indexDetails.onlyInTarget.push(tgtIdx.name);
          } else {
            const srcName = srcIdx!.name;
            const tgtName = tgtIdx!.name;
            if (srcName !== tgtName) {
              indexDetails.caseDiff.push({
                name: srcName,
                sourceName: srcName,
                targetName: tgtName
              });
            }
            // Сравниваем свойства индекса: уникальность, кластеризация, колонки
            const srcDesc = this.formatIndexDesc(srcIdx!);
            const tgtDesc = this.formatIndexDesc(tgtIdx!);
            if (srcDesc !== tgtDesc) {
              indexDetails.diff.push({
                name: srcName,
                sourceDesc: srcDesc,
                targetDesc: tgtDesc
              });
            }
          }
        }

        commonTables.push({
          schema: src.schema,
          name: src.name,
          columns: colDetails,
          indexes: indexDetails
        });
      }
    }

    // --- Процедуры (без деталей параметров, пока только имена) ---
    const allProcs = new Map<string, { source: ProcedureInfo | null, target: ProcedureInfo | null }>();
    (source.procedures || []).forEach(p => {
      const key = normalize(p.schema, p.name);
      if (!allProcs.has(key)) allProcs.set(key, { source: null, target: null });
      allProcs.get(key)!.source = p;
    });
    (target.procedures || []).forEach(p => {
      const key = normalize(p.schema, p.name);
      if (!allProcs.has(key)) allProcs.set(key, { source: null, target: null });
      allProcs.get(key)!.target = p;
    });

    const onlyInSourceProcs: ProcedureInfo[] = [];
    const onlyInTargetProcs: ProcedureInfo[] = [];
    const commonProcs: ProcedureInfo[] = [];
    const caseDiffProcs: { schema: string, name: string, sourceName: string, targetName: string }[] = [];

    for (let [key, pair] of allProcs) {
      if (pair.source && !pair.target) {
        onlyInSourceProcs.push(pair.source);
      } else if (!pair.source && pair.target) {
        onlyInTargetProcs.push(pair.target);
      } else {
        const src = pair.source!;
        const tgt = pair.target!;
        const srcFull = `${src.schema}.${src.name}`;
        const tgtFull = `${tgt.schema}.${tgt.name}`;
        if (srcFull !== tgtFull) {
          caseDiffProcs.push({
            schema: src.schema,
            name: src.name,
            sourceName: srcFull,
            targetName: tgtFull
          });
        }
        commonProcs.push(src);
      }
    }

    return {
      onlyInSource,
      onlyInTarget,
      common: commonTables,
      caseDifferences,
      onlyInSourceProcs,
      onlyInTargetProcs,
      commonProcs,
      caseDiffProcs
    };
  }

  // ---------- Webview ----------
  private _getWebviewContent(): string {
    const webviewFolder = vscode.Uri.joinPath(this.extensionUri, 'webview');
    const htmlPath = vscode.Uri.joinPath(webviewFolder, 'index.html');
    const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

    const config = vscode.workspace.getConfiguration();
    const lastSource = config.get<string>(CONFIG_KEYS.lastSource) || '';
    const lastTarget = config.get<string>(CONFIG_KEYS.lastTarget) || '';

    let processedHtml = htmlContent
      .replace(/\{\{lastSource\}\}/g, lastSource)
      .replace(/\{\{lastTarget\}\}/g, lastTarget);

    const styleUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, 'style.css'));
    const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewFolder, 'script.js'));

    processedHtml = processedHtml.replace('href="style.css"', `href="${styleUri}"`);
    processedHtml = processedHtml.replace('src="script.js"', `src="${scriptUri}"`);

    return processedHtml;
  }

  private sendMessage(message: any) {
    this._panel.webview.postMessage(message);
  }

  public dispose() {
    ComparePanel.currentPanel = undefined;
    this._disposables.forEach(d => d.dispose());
  }
}