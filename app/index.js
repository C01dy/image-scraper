const fs = require('fs/promises');
const path = require('path');

// Функция для парсинга аргументов командной строки
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    url: process.env.IMAGE_URL || 'http://apollo.sai.msu.ru/webcam.jpg',
    output: process.env.OUTPUT_DIR || '/app/images'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' || args[i] === '-u') {
      config.url = args[i + 1];
      i++;
    } else if (args[i] === '--output' || args[i] === '-o') {
      config.output = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Использование: bun app/index.js [опции]

Опции:
  -u, --url <url>        URL изображения для загрузки
                         По умолчанию: http://apollo.sai.msu.ru/webcam.jpg
                         
  -o, --output <path>    Путь к папке для сохранения изображений
                         По умолчанию: /app/images
                         
  -h, --help             Показать эту справку

Примеры:
  bun app/index.js --url http://example.com/image.jpg --output ./downloads
  bun app/index.js -u http://example.com/cam.jpg -o /tmp/images
  
Переменные окружения:
  IMAGE_URL              URL изображения (альтернатива флагу --url)
  OUTPUT_DIR             Папка сохранения (альтернатива флагу --output)
      `);
      process.exit(0);
    }
  }

  return config;
}

const config = parseArgs();
const imageUrl = config.url;
const outputDir = config.output;

async function downloadImage() {
  console.log(`🌐 URL: ${imageUrl}`);
  console.log(`📁 Папка сохранения: ${outputDir}`);
  console.log(`⏰ Время запуска: ${new Date().toLocaleString('ru-RU')}`);
  console.log('─'.repeat(50));
  
  try {
    // Проверяем валидность URL
    try {
      new URL(imageUrl);
    } catch (e) {
      throw new Error(`Невалидный URL: ${imageUrl}`);
    }

    // Создаем папку для сохранения, если она не существует
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`✓ Папка ${outputDir} готова`);

    console.log(`📥 Загрузка изображения...`);
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Ошибка HTTP: ${response.status} ${response.statusText}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const fileSizeKB = (imageBuffer.byteLength / 1024).toFixed(2);
    console.log(`✓ Загружено ${fileSizeKB} KB`);

    const date = new Date();
    const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}`;
    
    // Определяем расширение файла из URL или Content-Type
    let extension = 'jpg';
    const urlExtension = imageUrl.split('.').pop().split('?')[0].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(urlExtension)) {
      extension = urlExtension;
    }
    
    const fileName = `image-${formattedDate}.${extension}`;
    const outputPath = path.join(outputDir, fileName);

    await fs.writeFile(outputPath, Buffer.from(imageBuffer));
    
    console.log(`✅ Изображение успешно сохранено:`);
    console.log(`   📄 Файл: ${fileName}`);
    console.log(`   📍 Путь: ${outputPath}`);
    console.log(`   📏 Размер: ${fileSizeKB} KB`);

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

downloadImage();