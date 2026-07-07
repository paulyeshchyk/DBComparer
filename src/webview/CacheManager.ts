import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ICacheManager } from "../core/types";
import { Logger } from "./Logger";

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
