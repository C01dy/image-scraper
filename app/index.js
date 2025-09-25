const fs = require('fs/promises');
const path = require('path');

const imageUrl = 'http://apollo.sai.msu.ru/webcam.jpg';
const outputDir = process.env.OUTPUT_DIR || '/app/images';

async function downloadImage() {
  console.log(`Начинаю загрузку изображения с ${imageUrl}`);
  
  try {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Ошибка HTTP: ${response.status} ${response.statusText}`);
    }

    const imageBuffer = await response.arrayBuffer();

    const date = new Date();
    const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}`;
    const fileName = `image-${formattedDate}.jpg`;
    const outputPath = path.join(outputDir, fileName);

    await fs.writeFile(outputPath, Buffer.from(imageBuffer));
    console.log(`Изображение успешно сохранено в ${outputPath}`);

  } catch (error) {
    console.error('Не удалось скачать или сохранить изображение:', error);
  }
}

downloadImage();