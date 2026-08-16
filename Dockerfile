FROM ruby:3.4.10
ENV LANG C.UTF-8
ENV TZ Asia/Tokyo
RUN apt-get update -qq \
&& apt-get install -y ca-certificates curl gnupg \
&& mkdir -p /etc/apt/keyrings \
&& curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
&& NODE_MAJOR=18 \
&& curl -fsSL https://dl.yarnpkg.com/debian/pubkey.gpg | gpg --dearmor -o /etc/apt/keyrings/yarn.gpg \
&& echo "deb [signed-by=/etc/apt/keyrings/yarn.gpg] https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list \
&& apt-get update -qq \
&& apt-get install -y build-essential libpq-dev nodejs yarn
RUN mkdir /v3_beginner_rails
WORKDIR /v3_beginner_rails
RUN gem install bundler:2.6.9
COPY Gemfile /v3_beginner_rails/Gemfile
COPY Gemfile.lock /v3_beginner_rails/Gemfile.lock
COPY yarn.lock /v3_beginner_rails/yarn.lock
RUN bundle install
RUN yarn install
COPY . /v3_beginner_rails
