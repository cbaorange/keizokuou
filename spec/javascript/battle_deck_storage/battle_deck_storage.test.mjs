import test from "node:test"
import assert from "node:assert/strict"

import {
  autoSetCardInLocalDeck,
  resetLocalDeck,
} from "../../../app/javascript/battle_deck_storage.js"

function createStorage(deck = null) {
  let storedDeck = deck === null ? null : JSON.stringify(deck)
  let writeCount = 0

  return {
    getItem(key) {
      assert.equal(key, "deck")
      return storedDeck
    },
    setItem(key, value) {
      assert.equal(key, "deck")
      storedDeck = value
      writeCount += 1
    },
    deck() {
      return storedDeck === null ? null : JSON.parse(storedDeck)
    },
    writeCount() {
      return writeCount
    },
  }
}

test("新規登録開始時は既存キーへ空の5枠を保存する", () => {
  const storage = createStorage([1, 2, 3, 4, 5])

  assert.equal(resetLocalDeck(storage), true)
  assert.deepEqual(storage.deck(), [0, 0, 0, 0, 0])
  assert.equal(storage.writeCount(), 1)
})

test("保存できない環境でも新規登録処理を例外で止めない", () => {
  const storage = {
    setItem() {
      throw new Error("localStorage unavailable")
    },
  }

  assert.equal(resetLocalDeck(storage), false)
})

test("空欄があり未参加なら表示順先頭の空欄へ自動セットする", () => {
  const storage = createStorage([0, 3, 5, 0, 0])

  assert.equal(autoSetCardInLocalDeck(8, storage), true)
  assert.deepEqual(storage.deck(), [8, 3, 5, 0, 0])
})

test("参加済みカードは空欄があっても重複セットしない", () => {
  const storage = createStorage([8, 3, 5, 0, 0])

  assert.equal(autoSetCardInLocalDeck(8, storage), false)
  assert.deepEqual(storage.deck(), [8, 3, 5, 0, 0])
  assert.equal(storage.writeCount(), 0)
})

test("空欄がなければ既存デッキを変更しない", () => {
  const storage = createStorage([1, 3, 5, 7, 8])

  assert.equal(autoSetCardInLocalDeck(9, storage), false)
  assert.deepEqual(storage.deck(), [1, 3, 5, 7, 8])
  assert.equal(storage.writeCount(), 0)
})

test("空欄が複数あっても表示順先頭だけを埋める", () => {
  const storage = createStorage([0, 0, 5, 0, 0])

  assert.equal(autoSetCardInLocalDeck(9, storage), true)
  assert.deepEqual(storage.deck(), [9, 0, 5, 0, 0])
})

test("未保存デッキでも新規登録時の報酬カードを先頭へセットする", () => {
  const storage = createStorage()

  assert.equal(autoSetCardInLocalDeck(1, storage), true)
  assert.deepEqual(storage.deck(), [1, 0, 0, 0, 0])
})

test("初取得かどうかに依存せず報酬対象カードを自動セットする", () => {
  const storage = createStorage([1, 0, 5, 0, 0])

  assert.equal(autoSetCardInLocalDeck(3, storage), true)
  assert.deepEqual(storage.deck(), [1, 3, 5, 0, 0])
})

test("空文字、null、undefined相当も空欄として0へ正規化する", () => {
  const storage = createStorage(["", 3, null, 0, 5])

  assert.equal(autoSetCardInLocalDeck(8, storage), true)
  assert.deepEqual(storage.deck(), [8, 3, 0, 0, 5])
})
