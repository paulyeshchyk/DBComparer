import * as vscode from "vscode";
import { ProgressFormatResult } from "../core/types";

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
            this.refresh(true);
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

    private refresh(wantsDelay: boolean = true) {
        if (!wantsDelay) {
            this.doActualRefresh();
            return;
        }

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
