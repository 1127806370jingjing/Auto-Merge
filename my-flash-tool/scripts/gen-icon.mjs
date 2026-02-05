/**
 * 将 image.png 裁剪为正方形并输出为 icon-source.png，供 tauri icon 使用
 * 使用中心正方形裁剪，保留主体在画面中
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const input = path.join(root, 'image.png');
const output = path.join(root, 'icon-source.png');
const size = 1024;

const meta = await sharp(input).metadata();
const w = meta.width || 1;
const h = meta.height || 1;
const side = Math.min(w, h);
const left = Math.floor((w - side) / 2);
const top = Math.floor((h - side) / 2);

await sharp(input)
  .extract({ left, top, width: side, height: side })
  .resize(size, size)
  .png()
  .toFile(output);

console.log(`已生成正方形图标: ${output} (${size}x${size})`);
console.log('请执行: npm run tauri icon icon-source.png');
