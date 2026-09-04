export const formatTokenAmount = (value: number) => value === 0 ? '0' : value < 0.0001 ? '<0.0001' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
