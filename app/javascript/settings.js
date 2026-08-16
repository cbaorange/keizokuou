import {
  saveNickname,
  storedNickname
} from "./nickname_dialogue.js"

export const PASSWORD_CONFIRMATION_ERROR_MESSAGE =
  "新しいパスワードとパスワード確認が一致しません。"
export const PASSWORD_CHANGE_CONFIRMATION_MESSAGE =
  "パスワードを変更しますか？"

export function initializePasswordSettings(
  root = globalThis.document,
  confirmChange = (message) => globalThis.window.confirm(message)
) {
  const form = root.querySelector("[data-password-settings-form]")

  if (form === null) {
    return false
  }

  if (form.dataset.passwordRegistered !== "true") {
    return true
  }

  const password = form.querySelector('[name="password_settings[password]"]')
  const confirmation = form.querySelector(
    '[name="password_settings[password_confirmation]"]'
  )
  const errors = root.querySelector("[data-password-client-errors]")

  if (
    password === null ||
    confirmation === null ||
    errors === null
  ) {
    return false
  }

  const errorMessage = errors.querySelector("[data-password-client-error-message]")

  if (errorMessage === null) {
    return false
  }

  form.addEventListener("submit", (event) => {
    if (password.value !== confirmation.value) {
      event.preventDefault()
      errorMessage.textContent = PASSWORD_CONFIRMATION_ERROR_MESSAGE
      errors.hidden = false
      confirmation.focus()
      return
    }

    errors.hidden = true

    if (!confirmChange(PASSWORD_CHANGE_CONFIRMATION_MESSAGE)) {
      event.preventDefault()
    }
  })

  return true
}

export function initializeNicknameSettings(
  root = globalThis.document,
  storage = globalThis.localStorage
) {
  const form = root.querySelector("[data-nickname-settings-form]")
  const input = form?.querySelector("[data-nickname-settings-input]")
  const message = form?.querySelector("[data-nickname-settings-message]")

  if (form === null || form === undefined || input === null || message === null) {
    return false
  }

  try {
    input.value = storedNickname(storage)
  } catch (error) {
    console.error("ニックネームを読み込めませんでした", error)
    message.textContent = "ニックネームを読み込めませんでした。"
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault()

    try {
      input.value = saveNickname(storage, input.value)
      message.textContent = "ニックネームを保存しました。"
    } catch (error) {
      console.error("ニックネームを保存できませんでした", error)
      message.textContent = "ニックネームを保存できませんでした。"
    }
  })

  return true
}

if (typeof document !== "undefined") {
  initializePasswordSettings()
  initializeNicknameSettings()
}
