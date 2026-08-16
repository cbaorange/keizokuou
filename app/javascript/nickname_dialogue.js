export const NICKNAME_STORAGE_KEY = "keizokuou_nickname"

export function storedNickname(storage) {
  return storage?.getItem(NICKNAME_STORAGE_KEY)?.trim() ?? ""
}

export function saveNickname(storage, nickname) {
  const normalizedNickname = nickname.trim()

  if (normalizedNickname === "") {
    storage.removeItem(NICKNAME_STORAGE_KEY)
  } else {
    storage.setItem(NICKNAME_STORAGE_KEY, normalizedNickname)
  }

  return normalizedNickname
}

export function nicknameForDialogue(storage) {
  const nickname = storedNickname(storage)

  return nickname || "ユーザー"
}

export function replaceNicknamePlaceholder(message, nickname) {
  if (typeof message !== "string" || typeof nickname !== "string") {
    throw new TypeError("セリフとニックネームは文字列である必要があります")
  }

  return message.replaceAll("【nick】", nickname)
}
