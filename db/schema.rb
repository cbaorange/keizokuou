# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[7.0].define(version: 2026_08_08_090000) do
  create_table "battle_sessions", charset: "utf8mb4", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.string "token", null: false
    t.string "difficulty", null: false
    t.integer "display_rate_before_battle", default: 0, null: false
    t.integer "display_rate_win_bonus", default: 0, null: false
    t.boolean "completed", default: false, null: false
    t.string "result"
    t.integer "final_internal_rate"
    t.integer "final_display_rate"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["token"], name: "index_battle_sessions_on_token", unique: true
    t.index ["user_id"], name: "index_battle_sessions_on_user_id"
  end

  create_table "task_completions", charset: "utf8mb4", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.date "completed_date", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.integer "speaker_card_id"
    t.index ["user_id", "completed_date"], name: "index_task_completions_on_user_id_and_completed_date", unique: true
    t.index ["user_id"], name: "index_task_completions_on_user_id"
  end

  create_table "user_cards", charset: "utf8mb4", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.integer "card_id", null: false
    t.integer "exp", default: 1, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.integer "next_dialogue_index", default: 0, null: false
    t.index ["user_id", "card_id"], name: "index_user_cards_on_user_id_and_card_id", unique: true
    t.index ["user_id"], name: "index_user_cards_on_user_id"
  end

  create_table "users", charset: "utf8mb4", force: :cascade do |t|
    t.string "login_id", null: false
    t.string "password_digest"
    t.integer "display_rate"
    t.integer "internal_rate"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "authentication_token_digest", limit: 64
    t.index ["authentication_token_digest"], name: "index_users_on_authentication_token_digest", unique: true
    t.index ["login_id"], name: "index_users_on_login_id", unique: true
  end

  add_foreign_key "battle_sessions", "users"
  add_foreign_key "task_completions", "users"
  add_foreign_key "user_cards", "users"
end
