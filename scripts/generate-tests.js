/**
 * generate-tests.js
 *
 * Генератор тестов для Jest.
 * Автоматически создаёт .test.js файлы для модулей и (опционально) для браузерных скриптов.
 *
 * Использование:
 *   node generate-tests.js [rootDir] [options]
 *
 * Параметры:
 *   rootDir               - корневая директория для поиска JS-файлов (по умолчанию текущая)
 *
 * Опции:
 *   --output, -o <dir>    - директория для сохранения тестов (сохраняется структура подпапок)
 *   --overwrite, -f       - перезаписывать существующие тестовые файлы
 *   --iife                - генерировать тесты для браузерных скриптов (IIFE)
 *   --help, -h            - показать эту справку
 *
 * Примеры:
 *   node generate-tests.js ./src
 *   node generate-tests.js ./src --output ./tests
 *   node generate-tests.js ./src --output ./tests --iife
 *   node generate-tests.js --overwrite
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let rootDir = '.';
let outputDir = null;
let overwrite = false;
let generateIIFE = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
        console.log(`
Использование: node generate-tests.js [rootDir] [options]

Параметры:
  rootDir               - корневая директория для поиска JS-файлов (по умолчанию текущая)

Опции:
  --output, -o <dir>    - директория для сохранения тестов (сохраняется структура подпапок)
  --overwrite, -f       - перезаписывать существующие тестовые файлы
  --iife                - генерировать тесты для браузерных скриптов (IIFE)
  --help, -h            - показать эту справку

Примеры:
  node generate-tests.js ./src
  node generate-tests.js ./src --output ./tests
  node generate-tests.js ./src --output ./tests --iife
  node generate-tests.js --overwrite
        `);
        process.exit(0);
    } else if (arg === '--overwrite' || arg === '-f') {
        overwrite = true;
    } else if (arg === '--iife') {
        generateIIFE = true;
    } else if (arg === '--output' || arg === '-o') {
        if (i + 1 >= args.length) {
            console.error('Ошибка: --output требует путь к директории');
            process.exit(1);
        }
        outputDir = args[++i];
    } else if (!arg.startsWith('-')) {
        if (rootDir === '.') {
            rootDir = arg;
        } else {
            console.warn(`Игнорируем лишний аргумент: ${arg}`);
        }
    } else {
        console.warn(`Неизвестный аргумент: ${arg}`);
    }
}

/** @type string */
const absoluteRoot = path.resolve(rootDir);

/** @type string | null */
let absoluteOutput = null;
if (outputDir) {
    absoluteOutput = path.resolve(outputDir);
    if (!fs.existsSync(absoluteOutput)) {
        fs.mkdirSync(absoluteOutput, { recursive: true });
    }
}

const ignoreDirs = ['node_modules', '.git', 'coverage', 'dist', 'build', 'test'];
const ignoreFilesSuffix = ['.test.js', '.spec.js'];

/**
 * @param {string} fileName
 */
function isTestFile(fileName) {
    return ignoreFilesSuffix.some(suffix => fileName.endsWith(suffix));
}

/**
 * @param {string} dir
 */
function getAllJSFiles(dir) {
    /**
     * @type {any[]}
     */
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            if (!ignoreDirs.includes(file)) {
                results = results.concat(getAllJSFiles(filePath));
            }
        } else {
            if (file.endsWith('.js') && !isTestFile(file)) {
                results.push(filePath);
            }
        }
    });
    return results;
}

/**
 * @param {string} modulePath
 */
function getExportedNames(modulePath) {
    try {
        const moduleExports = require(modulePath);
        if (typeof moduleExports === 'function') {
            return { type: 'function', name: null };
        } else if (typeof moduleExports === 'object' && moduleExports !== null) {
            const keys = Object.keys(moduleExports).filter(key => typeof moduleExports[key] === 'function');
            if (keys.length === 0) {
                return { type: 'other' };
            }
            return { type: 'object', exports: keys };
        } else {
            return { type: 'other' };
        }
    } catch (err) {
        return { type: 'browser' };
    }
}

/**
 * @param {string} name
 */
function sanitizeIdentifier(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_');
}

/**
 * @param {string} modulePath
 * @param {string} testFilePath
 */
function getRelativeRequire(modulePath, testFilePath) {
    const testDir = path.dirname(testFilePath);
    let relative = path.relative(testDir, modulePath);
    relative = relative.replace(/\\/g, '/');
    if (relative.endsWith('.js')) {
        relative = relative.slice(0, -3);
    }
    if (!relative.startsWith('.')) {
        relative = './' + relative;
    }
    return relative;
}

/**
 * @param {string} modulePath
 * @param {any} testFilePath
 * @param {{ type: string; name: null; exports?: undefined; } | { type: string; name?: undefined; exports?: undefined; } | { type: string; exports: string[]; name?: undefined; }} info
 */
function generateModuleTest(modulePath, testFilePath, info) {
    const moduleName = path.basename(modulePath, '.js');
    const safeModuleName = sanitizeIdentifier(moduleName);
    const relativeRequire = getRelativeRequire(modulePath, testFilePath);
    let content = `const ${safeModuleName} = require('${relativeRequire}');\n\n`;

    if (info.type === 'function') {
        content += `describe('${moduleName}', () => {\n`;
        content += `    test('${safeModuleName} should be defined', () => {\n`;
        content += `        expect(${safeModuleName}).toBeDefined();\n`;
        content += `    });\n`;
        content += `    test.todo('${safeModuleName} should work correctly');\n`;
        content += `});\n`;
    } else if (info.type === 'object' && info.exports && info.exports.length > 0) {
        content += `describe('${moduleName}', () => {\n`;
        info.exports.forEach((/** @type {any} */ funcName) => {
            const safeFuncName = sanitizeIdentifier(funcName);
            content += `    test('${safeFuncName} should be defined', () => {\n`;
            content += `        expect(${safeModuleName}.${funcName}).toBeDefined();\n`;
            content += `    });\n`;
            content += `    test.todo('${safeFuncName} should work correctly');\n`;
        });
        content += `});\n`;
    } else {
        content += `describe('${moduleName}', () => {\n`;
        content += `    test('module should be defined', () => {\n`;
        content += `        expect(${safeModuleName}).toBeDefined();\n`;
        content += `    });\n`;
        content += `    test.todo('add more tests for ${moduleName}');\n`;
        content += `});\n`;
    }
    return content;
}

/**
 * @param {string} modulePath
 * @param {any} testFilePath
 */
function generateBrowserTest(modulePath, testFilePath) {
    const moduleName = path.basename(modulePath, '.js');
    const relativeRequire = getRelativeRequire(modulePath, testFilePath);
    return `
// Тест для браузерного скрипта: проверяем, что он загружается без ошибок
describe('${moduleName} (browser script)', () => {
    beforeAll(() => {
        global.window = {
            location: { pathname: '/test' },
            addEventListener: jest.fn(),
        };
        global.document = {
            readyState: 'complete',
            addEventListener: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            body: { ...document.body },
        };
        global.MutationObserver = class {
            observe() {}
        };
    });

    afterAll(() => {
        delete global.window;
        delete global.document;
        delete global.MutationObserver;
    });

    test('script should load without errors', () => {
        expect(() => {
            require('${relativeRequire}');
        }).not.toThrow();
    });

    test.todo('add integration tests using jsdom or Puppeteer');
});
`;
}

function generateTests() {
    const files = getAllJSFiles(absoluteRoot);
    console.log(`Найдено ${files.length} JS-файлов.`);

    files.forEach(filePath => {
        const info = getExportedNames(filePath);
        const isModule = info.type === 'function' || info.type === 'object';
        const isBrowser = info.type === 'browser' || info.type === 'other';

        let shouldGenerate = false;
        if (isModule) {
            shouldGenerate = true;
        } else if (isBrowser && generateIIFE) {
            shouldGenerate = true;
        } else {
            console.log(`Пропускаем ${filePath} (не модуль, флаг --iife не указан)`);
            return;
        }

        // Вычисляем целевой путь для теста
        const relativePath = path.relative(absoluteRoot, filePath);
        let testFilePath;
        if (absoluteOutput) {
            const outputRelative = path.dirname(relativePath);
            const baseName = path.basename(filePath, '.js') + '.test.js';
            const targetDir = path.join(absoluteOutput, outputRelative);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            testFilePath = path.join(targetDir, baseName);
        } else {
            testFilePath = filePath.replace(/\.js$/, '.test.js');
        }

        const exists = fs.existsSync(testFilePath);
        if (exists && !overwrite) {
            console.log(`Файл уже существует: ${testFilePath}, пропускаем.`);
            return;
        }

        console.log(`Генерируем тест для ${filePath} -> ${testFilePath}`);
        let content;
        if (isModule) {
            content = generateModuleTest(filePath, testFilePath, info);
        } else {
            content = generateBrowserTest(filePath, testFilePath);
        }
        fs.writeFileSync(testFilePath, content);
        console.log(`Создан ${testFilePath}`);
    });
    console.log('Готово!');
}

generateTests();
