/**
 * 统计中文字数
 * CJK 字符算 1 字，ASCII 单词按空格分隔算 1 词
 */
export function countWords(text: string): number {
  if (!text) return 0
  const cjkRegex = /[一-鿿㐀-䶿豈-﫿]/g
  const cjkCount = (text.match(cjkRegex) || []).length
  const asciiPart = text.replace(cjkRegex, ' ')
  const asciiWords = asciiPart.split(/\s+/).filter(w => w.length > 0).length
  return cjkCount + asciiWords
}
