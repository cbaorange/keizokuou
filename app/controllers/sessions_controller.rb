class SessionsController < ApplicationController
  TASK_JOB_MAX_LENGTH = 100
  PASSWORD_NOT_SET_MESSAGE = <<~MESSAGE.squish.freeze
    このアカウントには引き継ぎ用パスワードが設定されていないため、再ログインできません。
    登録した端末で引き続き利用してください。
  MESSAGE

  skip_before_action :require_authentication, only: [:new, :create]

  def new
    prepare_login_form
  end

  def create
    prepare_login_form

    unless login_input_valid?
      return render :new, status: :unprocessable_entity
    end

    user = User.find_by(login_id: @login_id)

    if user && user.password_digest.blank?
      add_login_error(PASSWORD_NOT_SET_MESSAGE)
      return render :new, status: :unprocessable_entity
    end

    unless user&.authenticate(login_params[:password].to_s)
      add_login_error("ログインIDまたはパスワードが正しくありません。")
      return render :new, status: :unprocessable_entity
    end

    establish_authentication_for(user)
    queue_initial_task(@login_job)
    flash[:nickname_to_store] = @nickname
    flash[:notice] = "再ログインしました。"
    redirect_to root_path
  end

  private

  def prepare_login_form
    @login_id = login_params[:login_id].to_s.strip.upcase
    @login_job = login_params[:job].to_s
    @nickname = login_params[:nickname].to_s
    @login_errors ||= []
  end

  def login_input_valid?
    if @nickname.strip.blank?
      add_login_error("ニックネームを入力してください。")
    end

    if @login_id.blank?
      add_login_error("ログインIDを入力してください。")
    end

    if login_params[:password].to_s.blank?
      add_login_error("パスワードを入力してください。")
    end

    stripped_job = @login_job.strip

    if stripped_job.blank?
      add_login_error("再び継続することを入力してください。")
    elsif stripped_job.length > TASK_JOB_MAX_LENGTH
      add_login_error("再び継続することは#{TASK_JOB_MAX_LENGTH}文字以内で入力してください。")
    else
      @login_job = stripped_job
    end

    @login_errors.empty?
  end

  def login_params
    params.fetch(:session, {}).permit(:login_id, :password, :job, :nickname)
  end

  def add_login_error(message)
    @login_errors ||= []
    @login_errors << message
  end
end
