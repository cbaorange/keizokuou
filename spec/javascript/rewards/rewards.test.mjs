import assert from "node:assert/strict"
import test from "node:test"

import {
  calculateFolderGeometry,
  calculateFolderMinimumHeight,
  calculatePopupWidth,
} from "../../../app/javascript/rewards.js"

test("YAML比率をフォルダ横幅基準の寸法へ変換する", () => {
  assert.deepEqual(calculateFolderGeometry(800, 0.37, 0.09), {
    slopeStart: 296,
    tabHeight: 72,
    slopeEnd: 368,
  })
})

test("横幅が変わっても3つの寸法が同じ比率で変化する", () => {
  assert.deepEqual(calculateFolderGeometry(400, 0.37, 0.09), {
    slopeStart: 148,
    tabHeight: 36,
    slopeEnd: 184,
  })
})

test("slope_start_ratioだけを変えると斜め開始位置が変わる", () => {
  assert.deepEqual(calculateFolderGeometry(800, 0.5, 0.09), {
    slopeStart: 400,
    tabHeight: 72,
    slopeEnd: 472,
  })
})

test("tab_height_ratioだけを変えると高さと斜め終了位置が変わる", () => {
  assert.deepEqual(calculateFolderGeometry(800, 0.37, 0.12), {
    slopeStart: 296,
    tabHeight: 96,
    slopeEnd: 392,
  })
})

test("ポップアップ幅を一覧フォルダの実測幅の2倍にする", () => {
  assert.equal(calculatePopupWidth(268.5), 537)
})

test("height_ratioをフォルダ幅に対する最低高さへ変換する", () => {
  assert.equal(calculateFolderMinimumHeight(300, 0.7), 210)
})

test("一覧とポップアップの形状比率を別々に計算できる", () => {
  const folder = calculateFolderGeometry(300, 0.37, 0.09)
  const popup = calculateFolderGeometry(600, 0.41, 0.07)

  assert.deepEqual(folder, {
    slopeStart: 111,
    tabHeight: 27,
    slopeEnd: 138,
  })
  assert.ok(Math.abs(popup.slopeStart - 246) < Number.EPSILON * 600)
  assert.ok(Math.abs(popup.tabHeight - 42) < Number.EPSILON * 600)
  assert.ok(Math.abs(popup.slopeEnd - 288) < Number.EPSILON * 600)
})
