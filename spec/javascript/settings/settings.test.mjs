import assert from "node:assert/strict"
import test from "node:test"

import {
  NICKNAME_STORAGE_KEY,
  nicknameForDialogue,
  saveNickname,
  storedNickname
} from "../../../app/javascript/nickname_dialogue.js"
import {
  initializeNicknameSettings,
  initializePasswordSettings,
  PASSWORD_CHANGE_CONFIRMATION_MESSAGE,
  PASSWORD_CONFIRMATION_ERROR_MESSAGE
} from "../../../app/javascript/settings.js"

function storageWith(initialValue = null) {
  const values = new Map()

  if (initialValue !== null) {
    values.set(NICKNAME_STORAGE_KEY, initialValue)
  }

  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    }
  }
}

function settingsDom() {
  const listeners = {}
  const input = { value: "" }
  const message = { textContent: "" }
  const form = {
    querySelector(selector) {
      if (selector === "[data-nickname-settings-input]") return input
      if (selector === "[data-nickname-settings-message]") return message
      return null
    },
    addEventListener(type, listener) {
      listeners[type] = listener
    }
  }
  const root = {
    querySelector(selector) {
      return selector === "[data-nickname-settings-form]" ? form : null
    }
  }

  return { input, listeners, message, root }
}

function passwordSettingsDom({ registered = true } = {}) {
  const formListeners = {}
  const password = { value: "", focus() {} }
  const confirmation = {
    focused: false,
    value: "",
    focus() {
      this.focused = true
    }
  }
  const errorMessage = { textContent: "" }
  const errors = {
    hidden: true,
    querySelector(selector) {
      return selector === "[data-password-client-error-message]"
        ? errorMessage
        : null
    }
  }
  const form = {
    dataset: { passwordRegistered: String(registered) },
    addEventListener(type, listener) {
      formListeners[type] = listener
    },
    querySelector(selector) {
      if (selector === '[name="password_settings[password]"]') return password
      if (selector === '[name="password_settings[password_confirmation]"]') {
        return confirmation
      }
      return null
    }
  }
  const root = {
    querySelector(selector) {
      if (selector === "[data-password-settings-form]") return form
      if (selector === "[data-password-client-errors]") return errors
      return null
    }
  }

  return {
    confirmation,
    errorMessage,
    errors,
    form,
    formListeners,
    password,
    root
  }
}

function submitEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true
    }
  }
}

test("既存キーの文字列を設定画面の初期値として読み取る", () => {
  const storage = storageWith(" にんじん ")
  const { input, root } = settingsDom()

  assert.equal(initializeNicknameSettings(root, storage), true)
  assert.equal(input.value, "にんじん")
  assert.equal(storedNickname(storage), "にんじん")
})

test("保存時は既存キーへtrim済み文字列を書き込む", () => {
  const storage = storageWith("以前")
  const { input, listeners, message, root } = settingsDom()
  initializeNicknameSettings(root, storage)
  input.value = " 新しい名前 "

  listeners.submit({ preventDefault() {} })

  assert.equal(storage.getItem(NICKNAME_STORAGE_KEY), "新しい名前")
  assert.equal(input.value, "新しい名前")
  assert.equal(message.textContent, "ニックネームを保存しました。")
  assert.equal(nicknameForDialogue(storage), "新しい名前")
})

test("空欄保存時は既存キーを削除して従来の表示名へ戻す", () => {
  const storage = storageWith("以前")

  assert.equal(saveNickname(storage, "   "), "")
  assert.equal(storage.getItem(NICKNAME_STORAGE_KEY), null)
  assert.equal(nicknameForDialogue(storage), "ユーザー")
})

test("確認入力が違う場合は送信を止めてブラウザ確認なしでエラーを表示する", () => {
  const dom = passwordSettingsDom()
  let confirmCount = 0
  initializePasswordSettings(dom.root, () => {
    confirmCount += 1
    return true
  })
  dom.password.value = "New_1234"
  dom.confirmation.value = "New_1235"
  const event = submitEvent()

  dom.formListeners.submit(event)

  assert.equal(event.prevented, true)
  assert.equal(confirmCount, 0)
  assert.equal(dom.errors.hidden, false)
  assert.equal(dom.errorMessage.textContent, PASSWORD_CONFIRMATION_ERROR_MESSAGE)
  assert.equal(dom.confirmation.focused, true)
})

test("確認入力が一致する場合だけブラウザ標準の確認を表示して送信する", () => {
  const dom = passwordSettingsDom()
  const confirmMessages = []
  initializePasswordSettings(dom.root, (message) => {
    confirmMessages.push(message)
    return true
  })
  dom.password.value = "New_1234"
  dom.confirmation.value = "New_1234"
  const event = submitEvent()

  dom.formListeners.submit(event)

  assert.equal(dom.errors.hidden, true)
  assert.deepEqual(confirmMessages, [PASSWORD_CHANGE_CONFIRMATION_MESSAGE])
  assert.equal(event.prevented, false)
})

test("ブラウザ標準の確認をキャンセルすると変更フォームを送信しない", () => {
  const dom = passwordSettingsDom()
  initializePasswordSettings(dom.root, () => false)
  dom.password.value = "New_1234"
  dom.confirmation.value = "New_1234"
  const event = submitEvent()

  dom.formListeners.submit(event)

  assert.equal(event.prevented, true)
})

test("初回パスワード登録ではブラウザ確認処理を追加しない", () => {
  const dom = passwordSettingsDom({ registered: false })

  assert.equal(initializePasswordSettings(dom.root), true)
  assert.equal(dom.formListeners.submit, undefined)
})
