// Пример скрипта для преобразования barrel-файла
const fs = require('fs');

// Функция для преобразования одного файла
/**
 * @param {fs.PathOrFileDescriptor} barrelPath
 */
function convertBarrel(barrelPath) {
    let content = fs.readFileSync(barrelPath, 'utf8');
    const exports = [];

    // Ищем все строки с export * from './...'
    const exportRegex = /export \* from '\.\/(.*?)';/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
    }

    if (exports.length === 0) {
        console.log(`В файле ${barrelPath} не найдено экспортов.`);
        return;
    }

    // Генерируем новое содержимое в формате CommonJS
    let newContent = 'module.exports = {\n';
    exports.forEach(exp => {
        newContent += `    ...require('./${exp}'),\n`;
    });
    newContent += '};';

    // Сохраняем изменения (лучше сохранять в новый файл)
    fs.writeFileSync(barrelPath, newContent);
    console.log(`Файл ${barrelPath} успешно преобразован в CommonJS.`);
}

// Укажите путь к вашему barrel-файлу
const barrelFile = 'C:\\projects\\ascon\\GULF_Help_DiplodocHelper\\src\\plugins\\utils\\index.js';
if (fs.existsSync(barrelFile)) {
    convertBarrel(barrelFile);
} else {
    console.log(`Файл ${barrelFile} не найден.`);
}
