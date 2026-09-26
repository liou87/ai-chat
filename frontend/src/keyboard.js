// 回车提交的统一判断：输入法组词时按回车只是上屏候选词（isComposing，部分浏览器用 keyCode 229 表示），
// 不能当成提交，否则用拼音打英文单词时一按回车消息就半截发出去了
export function isSubmitEnter(e) {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229
}
