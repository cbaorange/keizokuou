class UsersController < ApplicationController
  INITIAL_CARD_EXP = 1
  TASK_JOB_MAX_LENGTH = 100

  skip_before_action :require_authentication, only: [:new, :create]

  def new
    prepare_registration_form
  end

  # 入力値をUser属性へ渡さず、ユーザーと初期カードをまとめて作成する
  def create
    prepare_registration_form

    unless registration_input_valid?
      return render :new, status: :unprocessable_entity
    end

    card_data = RegistrationChoiceCatalog.card_data_for!(@registration_choice)
    user = User.build_for_registration

    User.transaction do
      user.save!
      user.user_cards.create!(
        card_id: card_data.fetch("id"),
        exp: INITIAL_CARD_EXP
      )
    end

    establish_authentication_for(user)
    queue_initial_task(@registration_job)
    flash[:nickname_to_store] = @nickname
    flash[:initial_card_reward_choice] = @registration_choice
    flash[:notice] = registration_notice(user)
    redirect_to root_path
  rescue RegistrationChoiceCatalog::InvalidChoiceError
    add_registration_error("最も当てはまるものを正しく選択してください。")
    render :new, status: :unprocessable_entity
  rescue RegistrationChoiceCatalog::SyukamonConfigurationError
    add_registration_error("選択した初期シュカモンを確認できませんでした。時間をおいて再度お試しください。")
    render :new, status: :unprocessable_entity
  rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
    add_registration_error("アカウントを作成できませんでした。入力内容を確認して再度お試しください。")
    render :new, status: :unprocessable_entity
  rescue User::AccountIdGenerationError
    add_registration_error("ログインIDを生成できませんでした。時間をおいて再度お試しください。")
    render :new, status: :internal_server_error
  end

  private

  def prepare_registration_form
    form_params = params.fetch(:registration, {}).permit(:job, :choice, :nickname)
    @registration_job = form_params[:job].to_s
    @registration_choice = form_params[:choice].to_s
    @nickname = form_params[:nickname].to_s
    @registration_options = RegistrationChoiceCatalog.options
    @registration_errors ||= []
  end

  def registration_input_valid?
    if @nickname.strip.blank?
      add_registration_error("ニックネームを入力してください。")
    end

    stripped_job = @registration_job.strip

    if stripped_job.blank?
      add_registration_error("継続することを入力してください。")
    elsif stripped_job.length > TASK_JOB_MAX_LENGTH
      add_registration_error("継続することは#{TASK_JOB_MAX_LENGTH}文字以内で入力してください。")
    else
      @registration_job = stripped_job
    end

    if @registration_choice.blank?
      add_registration_error("最も当てはまるものを選択してください。")
    elsif !RegistrationChoiceCatalog::CHOICES.key?(@registration_choice)
      add_registration_error("最も当てはまるものを正しく選択してください。")
    end

    @registration_errors.empty?
  end

  def add_registration_error(message)
    @registration_errors ||= []
    @registration_errors << message
  end

  def registration_notice(user)
    notice = "登録が完了しました。"

    if Debug.enabled?
      notice += " デバッグ用ログインID：#{user.login_id}"
    end

    notice
  end
end
