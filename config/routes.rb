Rails.application.routes.draw do
  get "rewards", to: "rewards#show", as: :rewards
  get "/guide", to: "helps#show", as: :guide
  get "/help", to: redirect("/guide")
  get "/settings", to: "settings#show", as: :settings
  patch "/settings/password", to: "settings#update_password", as: :settings_password


  root 'tasks#index'
  get "/tasks", to: "tasks#index"
  post "tasks", to: "tasks#create"
  get "/cards", to: "cards#index"

  # アカウント登録画面と登録処理だけを公開する
  resources :users, only: [:new, :create]
  get "/login", to: "sessions#new", as: :login
  post "/login", to: "sessions#create"

  get "battle", to: "battles#show", as: :battle
  post "battle/session/result", to: "battle_sessions#result", as: :battle_session_result

  unless Rails.env.production?
    get "battle/debug", to: "battles#debug", as: :battle_debug
  end

  get "/up", to: proc {
    [200, { "Content-Type" => "text/plain" }, ["OK"]]
  }
end
