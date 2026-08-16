import * as bootstrap from "bootstrap"
import "./battle_launcher.js"
import { resetLocalDeck } from "./battle_deck_storage.js"

// 新規登録フォームだけを対象に、通常操作での二重送信を防ぐ
const registrationForm = document.querySelector("[data-registration-form]")

if (registrationForm !== null) {
  registrationForm.addEventListener("submit", (event) => {
    if (registrationForm.dataset.submitting === "true") {
      event.preventDefault()
      return
    }

    resetLocalDeck(localStorage)

    const submitButton = registrationForm.querySelector(
      "[data-registration-submit]"
    )

    registrationForm.dataset.submitting = "true"

    if (submitButton !== null) {
      submitButton.disabled = true
      submitButton.value = "登録中…"
    }
  })
}
