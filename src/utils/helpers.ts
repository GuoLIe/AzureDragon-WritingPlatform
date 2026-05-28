/** 暂停指定毫秒数，用于控制请求频率 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
