#!/bin/bash

# Скрипт для запуска image scraper с параметрами
# Использование: ./run-scraper.sh <url> <output_folder>

URL=$1
OUTPUT_FOLDER=$2
IMAGE_NAME="image-downloader-app"

if [ -z "$URL" ] || [ -z "$OUTPUT_FOLDER" ]; then
    echo "Usage: $0 <url> <output_folder>"
    exit 1
fi

# Создаем папку, если не существует
mkdir -p "$OUTPUT_FOLDER"

# Запускаем контейнер
docker run --rm \
    -v "$OUTPUT_FOLDER:/app/images" \
    "$IMAGE_NAME" \
    bun app/index.js \
    --url "$URL" \
    --output /app/images

echo "$(date): Downloaded from $URL to $OUTPUT_FOLDER" >> /opt/apps/image-scraper/scraper.log